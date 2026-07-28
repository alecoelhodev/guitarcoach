import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const PRISMA_ERROR_UNIQUE_CONSTRAINT = 'P2002';
const PRISMA_ERROR_RECORD_NOT_FOUND = 'P2025';

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
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: {
          email: normalizeEmail(dto.email),
          displayName: dto.displayName,
        },
      });
    } catch (error) {
      if (isPrismaErrorCode(error, PRISMA_ERROR_UNIQUE_CONSTRAINT)) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }

  findAll(): Promise<User[]> {
    return this.prisma.user.findMany();
  }

  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
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

  async remove(id: string): Promise<void> {
    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (error) {
      if (isPrismaErrorCode(error, PRISMA_ERROR_RECORD_NOT_FOUND)) {
        throw new NotFoundException(`User with id "${id}" not found`);
      }
      throw error;
    }
  }
}
