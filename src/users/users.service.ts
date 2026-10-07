import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GcpStorageService } from '../gcp-storage/gcp-storage.service';
import { Prisma } from '../generated/prisma/client';
import { SecurityEventLogger } from '../observability/security-event.logger';
import { ownAvatarObject } from './avatar.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';

const PRISMA_ERROR_UNIQUE_CONSTRAINT = 'P2002';
const PRISMA_ERROR_RECORD_NOT_FOUND = 'P2025';
const GCS_DELETE_CONCURRENCY = 5;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isPrismaErrorCode(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly securityEventLogger: SecurityEventLogger,
    private readonly gcpStorage: GcpStorageService,
  ) {}

  findAll(): Promise<UserResponseDto[]> {
    return this.prisma.user.findMany();
  }

  async findById(id: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const data: Prisma.UserUpdateInput = {};
    if (dto.email !== undefined) {
      data.email = normalizeEmail(dto.email);
    }
    if (dto.displayName !== undefined) {
      data.displayName = dto.displayName;
    }

    try {
      return await this.prisma.user.update({ where: { id }, data });
    } catch (error) {
      if (isPrismaErrorCode(error, PRISMA_ERROR_RECORD_NOT_FOUND)) {
        throw new NotFoundException(`User with id "${id}" not found`);
      }
      if (isPrismaErrorCode(error, PRISMA_ERROR_UNIQUE_CONSTRAINT)) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }

  async remove(actorId: string, id: string): Promise<void> {
    await this.purge(id);

    // Audit trail entry — only reached once the delete has actually
    // committed, never on a failed/not-found delete.
    this.securityEventLogger.log({
      eventType: 'user.deleted',
      outcome: 'success',
      actorId,
      targetType: 'user',
      targetId: id,
    });
  }

  async deleteAccount(userId: string): Promise<void> {
    await this.purge(userId);

    this.securityEventLogger.log({
      eventType: 'user.self_deleted',
      outcome: 'success',
      actorId: userId,
      targetType: 'user',
      targetId: userId,
    });
  }

  /**
   * Deletes a user and everything they own. Routine, PracticeSession and
   * Recording FKs are Restrict, so children go first; Session and Account
   * cascade. Storage objects (recordings and the avatar) are removed only after the commit, so a GCS
   * failure can never leave a half-deleted account.
   */
  private async purge(userId: string): Promise<void> {
    const objectNames = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { image: true },
      });
      if (!user) {
        throw new NotFoundException(`User with id "${userId}" not found`);
      }

      const recordings = await tx.recording.findMany({
        where: { userId },
        select: { objectName: true },
      });

      await tx.recording.deleteMany({ where: { userId } });
      await tx.practiceSessionTask.deleteMany({
        where: { practiceSession: { userId } },
      });
      await tx.practiceSession.deleteMany({ where: { userId } });
      await tx.routineTask.deleteMany({ where: { routine: { userId } } });
      await tx.routine.deleteMany({ where: { userId } });
      // After the session and routine rows above, the only things that can point at them.
      await tx.task.deleteMany({ where: { ownerId: userId } });
      await tx.user.delete({ where: { id: userId } });

      const avatar = ownAvatarObject(userId, user.image);
      return [
        ...recordings.map((r) => r.objectName),
        ...(avatar ? [avatar] : []),
      ];
    });

    await this.deleteObjects(userId, objectNames);
  }

  private async deleteObjects(
    userId: string,
    objectNames: string[],
  ): Promise<void> {
    for (let i = 0; i < objectNames.length; i += GCS_DELETE_CONCURRENCY) {
      const batch = objectNames.slice(i, i + GCS_DELETE_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((name) => this.gcpStorage.deleteObject(name)),
      );
      results.forEach((result, j) => {
        if (result.status === 'rejected') {
          this.logger.error(
            `Orphaned storage object "${batch[j]}" after deleting user "${userId}"`,
            result.reason,
          );
        }
      });
    }
  }
}
