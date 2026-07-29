import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Task } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { FindTasksQueryDto } from './dto/find-tasks-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

const PRISMA_ERROR_RECORD_NOT_FOUND = 'P2025';
const PRISMA_ERROR_FOREIGN_KEY_CONSTRAINT = 'P2003';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
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
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateTaskDto): Promise<Task> {
    return this.prisma.task.create({ data: dto });
  }

  async findAll(query: FindTasksQueryDto): Promise<PaginatedResult<Task>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const where: Prisma.TaskWhereInput = {
      ...(query.category !== undefined && { category: query.category }),
      ...(query.difficulty !== undefined && { difficulty: query.difficulty }),
    };

    const [data, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.task.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(id: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { id } });

    if (!task) {
      throw new NotFoundException(`Task with id "${id}" not found`);
    }

    return task;
  }

  async update(id: string, dto: UpdateTaskDto): Promise<Task> {
    try {
      return await this.prisma.task.update({ where: { id }, data: dto });
    } catch (error) {
      if (isPrismaErrorCode(error, PRISMA_ERROR_RECORD_NOT_FOUND)) {
        throw new NotFoundException(`Task with id "${id}" not found`);
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.prisma.task.delete({ where: { id } });
    } catch (error) {
      if (isPrismaErrorCode(error, PRISMA_ERROR_RECORD_NOT_FOUND)) {
        throw new NotFoundException(`Task with id "${id}" not found`);
      }
      if (isPrismaErrorCode(error, PRISMA_ERROR_FOREIGN_KEY_CONSTRAINT)) {
        throw new ConflictException(
          `Task with id "${id}" is referenced by a routine and cannot be deleted`,
        );
      }
      throw error;
    }
  }
}
