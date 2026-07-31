import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, Routine, RoutineTask } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisLockService } from '../redis/redis-lock.service';
import { RoutineCreatedProducer } from './events/routine-created.producer';
import { AddRoutineTaskDto } from './dto/add-routine-task.dto';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { FindRoutinesQueryDto } from './dto/find-routines-query.dto';
import { ReorderRoutineTasksDto } from './dto/reorder-routine-tasks.dto';
import { UpdateRoutineDto } from './dto/update-routine.dto';
import { UpdateRoutineTaskDto } from './dto/update-routine-task.dto';

const PRISMA_ERROR_RECORD_NOT_FOUND = 'P2025';
const PRISMA_ERROR_FOREIGN_KEY_CONSTRAINT = 'P2003';
const PRISMA_ERROR_UNIQUE_CONSTRAINT = 'P2002';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

// Covers the two-phase reorder transaction with margin; if a holder crashes
// mid-transaction the lock still self-clears via this TTL instead of
// blocking the routine's reorder endpoint forever.
const REORDER_LOCK_TTL_MS = 5000;

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export type RoutineTaskWithTask = Prisma.RoutineTaskGetPayload<{
  include: { task: true };
}>;

function isPrismaErrorCode(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function notFound(id: string): NotFoundException {
  return new NotFoundException(`Routine with id "${id}" not found`);
}

@Injectable()
export class RoutinesService {
  private readonly logger = new Logger(RoutinesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisLock: RedisLockService,
    private readonly routineCreatedProducer: RoutineCreatedProducer,
  ) {}

  async create(userId: string, dto: CreateRoutineDto): Promise<Routine> {
    const routine = await this.prisma.routine.create({
      data: { ...dto, userId },
    });

    // Publishing is a side effect of a creation that already succeeded in
    // the database — a broker hiccup must not turn into a failed request.
    // RoutineCreatedProducer.publish is itself non-throwing (it subscribes
    // to its own error channel), but this guards against a synchronous
    // throw before that subscription is set up.
    try {
      this.routineCreatedProducer.publish(routine);
    } catch (error) {
      this.logger.warn('Failed to publish routine.created event', error);
    }

    return routine;
  }

  async findAll(
    userId: string,
    query: FindRoutinesQueryDto,
  ): Promise<PaginatedResult<Routine>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const where: Prisma.RoutineWhereInput = {
      userId,
      ...(query.status !== undefined && { status: query.status }),
    };

    const [data, total] = await Promise.all([
      this.prisma.routine.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.routine.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(userId: string, id: string): Promise<Routine> {
    const routine = await this.prisma.routine.findFirst({
      where: { id, userId },
    });

    if (!routine) {
      throw notFound(id);
    }

    return routine;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateRoutineDto,
  ): Promise<Routine> {
    const { count } = await this.prisma.routine.updateMany({
      where: { id, userId },
      data: dto,
    });

    if (count === 0) {
      throw notFound(id);
    }

    return this.prisma.routine.findUniqueOrThrow({ where: { id } });
  }

  async remove(userId: string, id: string): Promise<void> {
    try {
      const { count } = await this.prisma.routine.deleteMany({
        where: { id, userId },
      });

      if (count === 0) {
        throw notFound(id);
      }
    } catch (error) {
      if (isPrismaErrorCode(error, PRISMA_ERROR_FOREIGN_KEY_CONSTRAINT)) {
        throw new ConflictException(
          `Routine with id "${id}" has tasks assigned and cannot be deleted`,
        );
      }
      throw error;
    }
  }

  async findTasks(
    userId: string,
    routineId: string,
  ): Promise<RoutineTaskWithTask[]> {
    await this.findById(userId, routineId);

    return this.prisma.routineTask.findMany({
      where: { routineId },
      orderBy: { position: 'asc' },
      include: { task: true },
    });
  }

  async addTask(
    userId: string,
    routineId: string,
    dto: AddRoutineTaskDto,
  ): Promise<RoutineTask> {
    await this.findById(userId, routineId);
    const position = dto.position ?? (await this.nextPosition(routineId));

    try {
      return await this.prisma.routineTask.create({
        data: {
          routineId,
          taskId: dto.taskId,
          position,
          targetDurationMinutes: dto.targetDurationMinutes,
        },
      });
    } catch (error) {
      if (isPrismaErrorCode(error, PRISMA_ERROR_UNIQUE_CONSTRAINT)) {
        throw new ConflictException(
          'Task is already assigned to this routine, or its position is taken',
        );
      }
      if (isPrismaErrorCode(error, PRISMA_ERROR_FOREIGN_KEY_CONSTRAINT)) {
        throw new NotFoundException(`Task with id "${dto.taskId}" not found`);
      }
      throw error;
    }
  }

  private async nextPosition(routineId: string): Promise<number> {
    const last = await this.prisma.routineTask.findFirst({
      where: { routineId },
      orderBy: { position: 'desc' },
    });

    return (last?.position ?? 0) + 1;
  }

  async updateTask(
    userId: string,
    routineId: string,
    taskId: string,
    dto: UpdateRoutineTaskDto,
  ): Promise<RoutineTask> {
    await this.findById(userId, routineId);

    try {
      return await this.prisma.routineTask.update({
        where: { routineId_taskId: { routineId, taskId } },
        data: dto,
      });
    } catch (error) {
      if (isPrismaErrorCode(error, PRISMA_ERROR_RECORD_NOT_FOUND)) {
        throw new NotFoundException(
          `Task "${taskId}" is not assigned to routine "${routineId}"`,
        );
      }
      if (isPrismaErrorCode(error, PRISMA_ERROR_UNIQUE_CONSTRAINT)) {
        throw new ConflictException(
          'Another task in this routine already has that position',
        );
      }
      throw error;
    }
  }

  async removeTask(
    userId: string,
    routineId: string,
    taskId: string,
  ): Promise<void> {
    await this.findById(userId, routineId);

    try {
      await this.prisma.routineTask.delete({
        where: { routineId_taskId: { routineId, taskId } },
      });
    } catch (error) {
      if (isPrismaErrorCode(error, PRISMA_ERROR_RECORD_NOT_FOUND)) {
        throw new NotFoundException(
          `Task "${taskId}" is not assigned to routine "${routineId}"`,
        );
      }
      throw error;
    }
  }

  async reorderTasks(
    userId: string,
    routineId: string,
    dto: ReorderRoutineTasksDto,
  ): Promise<RoutineTask[]> {
    await this.findById(userId, routineId);

    // Two concurrent reorders for the same routine can both pass validation
    // against the pre-reorder state and then interleave their writes,
    // corrupting `position` ordering. Serialize per-routine with a Redis
    // lock so only one reorder is in flight at a time; a second concurrent
    // request fails fast with 409 rather than queuing.
    const lockKey = this.reorderLockKey(routineId);
    let lockToken: string | null;
    try {
      lockToken = await this.redisLock.acquire(lockKey, REORDER_LOCK_TTL_MS);
    } catch (error) {
      this.logger.warn('Failed to acquire reorder lock', error);
      throw new ServiceUnavailableException(
        'Reordering is temporarily unavailable',
      );
    }

    if (!lockToken) {
      throw new ConflictException(
        'Another reorder is already in progress for this routine',
      );
    }

    try {
      const existing = await this.prisma.routineTask.findMany({
        where: { routineId },
      });
      const existingIds = new Set(existing.map((rt) => rt.taskId));
      const requestedIds = new Set(dto.taskIds);
      const isSameSet =
        dto.taskIds.length === existing.length &&
        requestedIds.size === dto.taskIds.length &&
        dto.taskIds.every((id) => existingIds.has(id));

      if (!isSameSet) {
        throw new BadRequestException(
          'taskIds must include every task currently assigned to this routine exactly once',
        );
      }

      // Postgres checks the unique(routineId, position) constraint per-statement
      // (not deferred), so writing final positions directly would conflict with
      // whatever task currently holds that slot. Move everything to negative
      // placeholder positions first, then to their final positions.
      await this.prisma.$transaction([
        ...dto.taskIds.map((taskId, index) =>
          this.prisma.routineTask.update({
            where: { routineId_taskId: { routineId, taskId } },
            data: { position: -(index + 1) },
          }),
        ),
        ...dto.taskIds.map((taskId, index) =>
          this.prisma.routineTask.update({
            where: { routineId_taskId: { routineId, taskId } },
            data: { position: index + 1 },
          }),
        ),
      ]);

      return await this.prisma.routineTask.findMany({
        where: { routineId },
        orderBy: { position: 'asc' },
      });
    } finally {
      try {
        await this.redisLock.release(lockKey, lockToken);
      } catch (error) {
        this.logger.warn('Failed to release reorder lock', error);
      }
    }
  }

  private reorderLockKey(routineId: string): string {
    return `lock:routine:${routineId}:reorder`;
  }
}
