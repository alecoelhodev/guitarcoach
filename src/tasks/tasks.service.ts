import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { Prisma, Task } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { FindTasksQueryDto } from './dto/find-tasks-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

const PRISMA_ERROR_RECORD_NOT_FOUND = 'P2025';
const PRISMA_ERROR_FOREIGN_KEY_CONSTRAINT = 'P2003';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

const TASK_CACHE_PREFIX = 'tasks';
// Generic Cache interface has no key-enumeration/pattern-delete, so list
// entries are invalidated by bumping a version embedded in their key rather
// than deleting them individually — old versions simply expire via TTL.
const TASK_LIST_VERSION_KEY = `${TASK_CACHE_PREFIX}:list:version`;

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
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async create(dto: CreateTaskDto): Promise<Task> {
    const task = await this.prisma.task.create({ data: dto });
    await this.bumpListCacheVersion();
    return task;
  }

  async findAll(query: FindTasksQueryDto): Promise<PaginatedResult<Task>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const cacheKey = await this.listCacheKey(
      page,
      limit,
      query.category,
      query.difficulty,
    );
    const cached = await this.safeCacheGet<PaginatedResult<Task>>(cacheKey);
    if (cached) {
      return cached;
    }

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

    const result: PaginatedResult<Task> = {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
    await this.safeCacheSet(cacheKey, result);

    return result;
  }

  async findById(id: string): Promise<Task> {
    const cacheKey = this.taskCacheKey(id);
    const cached = await this.safeCacheGet<Task>(cacheKey);
    if (cached) {
      return cached;
    }

    const task = await this.prisma.task.findUnique({ where: { id } });

    if (!task) {
      throw new NotFoundException(`Task with id "${id}" not found`);
    }

    await this.safeCacheSet(cacheKey, task);

    return task;
  }

  async update(id: string, dto: UpdateTaskDto): Promise<Task> {
    try {
      const task = await this.prisma.task.update({
        where: { id },
        data: dto,
      });
      await Promise.all([
        this.safeCacheDel(this.taskCacheKey(id)),
        this.bumpListCacheVersion(),
      ]);
      return task;
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
      await Promise.all([
        this.safeCacheDel(this.taskCacheKey(id)),
        this.bumpListCacheVersion(),
      ]);
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

  private taskCacheKey(id: string): string {
    return `${TASK_CACHE_PREFIX}:${id}`;
  }

  private async listCacheKey(
    page: number,
    limit: number,
    category?: string,
    difficulty?: string,
  ): Promise<string> {
    const version =
      (await this.safeCacheGet<number>(TASK_LIST_VERSION_KEY)) ?? 0;
    return `${TASK_CACHE_PREFIX}:list:v${version}:${page}:${limit}:${category ?? ''}:${difficulty ?? ''}`;
  }

  private async bumpListCacheVersion(): Promise<void> {
    const version =
      (await this.safeCacheGet<number>(TASK_LIST_VERSION_KEY)) ?? 0;
    await this.safeCacheSet(TASK_LIST_VERSION_KEY, version + 1, 0);
  }

  // Redis is an optimization here, not a dependency: on any cache failure we
  // log and fall back to a miss/no-op so Postgres remains the source of truth
  // and a Redis outage doesn't take down task reads/writes.
  private async safeCacheGet<T>(key: string): Promise<T | undefined> {
    try {
      return await this.cache.get<T>(key);
    } catch (error) {
      this.logger.warn(`Cache get failed for key "${key}"`, error);
      return undefined;
    }
  }

  private async safeCacheSet(
    key: string,
    value: unknown,
    ttl?: number,
  ): Promise<void> {
    try {
      if (ttl === undefined) {
        await this.cache.set(key, value);
      } else {
        await this.cache.set(key, value, ttl);
      }
    } catch (error) {
      this.logger.warn(`Cache set failed for key "${key}"`, error);
    }
  }

  private async safeCacheDel(key: string): Promise<void> {
    try {
      await this.cache.del(key);
    } catch (error) {
      this.logger.warn(`Cache del failed for key "${key}"`, error);
    }
  }
}
