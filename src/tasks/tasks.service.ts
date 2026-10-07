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
import { meters } from '../observability/metrics/meters';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { FindTasksQueryDto } from './dto/find-tasks-query.dto';
import {
  PaginatedTasksResponseDto,
  TaskResponseDto,
} from './dto/task-response.dto';
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

  async create(dto: CreateTaskDto): Promise<TaskResponseDto> {
    const task = await this.prisma.task.create({ data: dto });
    await this.bumpListCacheVersion();
    return task;
  }

  async findAll(query: FindTasksQueryDto): Promise<PaginatedTasksResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const cacheKey = await this.listCacheKey(
      page,
      limit,
      query.category,
      query.difficulty,
      query.q,
    );
    const cached = await this.safeCacheGet<PaginatedResult<Task>>(cacheKey);
    if (cached) {
      return cached;
    }

    const where: Prisma.TaskWhereInput = {
      ...(query.category !== undefined && { category: query.category }),
      ...(query.difficulty !== undefined && { difficulty: query.difficulty }),
      ...(query.q !== undefined && {
        title: { contains: escapeLike(query.q), mode: 'insensitive' },
      }),
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

  // Deliberately uncached and separate from the paginated, Redis-cached
  // findAll() used by the public GET /tasks endpoint -- this is an
  // internal/tool-only listing (the task catalog is small), so a second
  // cache-key shape for one caller isn't worth it.
  findAllUnpaginated(): Promise<Task[]> {
    return this.prisma.task.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findById(id: string): Promise<TaskResponseDto> {
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

  async update(id: string, dto: UpdateTaskDto): Promise<TaskResponseDto> {
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
    const inUse = () =>
      new ConflictException(
        `Task with id "${id}" is used by a routine or a logged practice session and cannot be deleted`,
      );

    try {
      await this.prisma.$transaction(async (tx) => {
        // Checked explicitly: Postgres 18 reports the RESTRICT violation as 23001,
        // which Prisma does not map to P2003, so relying on the FK error gave a 500.
        if (
          (await tx.routineTask.count({ where: { taskId: id } })) > 0 ||
          (await tx.practiceSessionTask.count({ where: { taskId: id } })) > 0
        ) {
          throw inUse();
        }

        const { count } = await tx.task.deleteMany({ where: { id } });
        if (count === 0) {
          throw new NotFoundException(`Task with id "${id}" not found`);
        }
      });
    } catch (error) {
      if (isPrismaErrorCode(error, PRISMA_ERROR_FOREIGN_KEY_CONSTRAINT)) {
        throw inUse();
      }
      throw error;
    }

    await Promise.all([
      this.safeCacheDel(this.taskCacheKey(id)),
      this.bumpListCacheVersion(),
    ]);
  }

  private taskCacheKey(id: string): string {
    return `${TASK_CACHE_PREFIX}:${id}`;
  }

  private async listCacheKey(
    page: number,
    limit: number,
    category?: string,
    difficulty?: string,
    q?: string,
  ): Promise<string> {
    const version =
      (await this.safeCacheGet<number>(TASK_LIST_VERSION_KEY)) ?? 0;
    // Lower-cased because the match is case-insensitive; encoded so a ':' in the search
    // can't shift the other segments.
    const search = q === undefined ? '' : encodeURIComponent(q.toLowerCase());
    return `${TASK_CACHE_PREFIX}:list:v${version}:${page}:${limit}:${category ?? ''}:${difficulty ?? ''}:${search}`;
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
      meters.redisOperationFailuresTotal.add(1, {
        client: 'cache',
        operation: 'get',
      });
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
      meters.redisOperationFailuresTotal.add(1, {
        client: 'cache',
        operation: 'set',
      });
      this.logger.warn(`Cache set failed for key "${key}"`, error);
    }
  }

  private async safeCacheDel(key: string): Promise<void> {
    try {
      await this.cache.del(key);
    } catch (error) {
      meters.redisOperationFailuresTotal.add(1, {
        client: 'cache',
        operation: 'del',
      });
      this.logger.warn(`Cache del failed for key "${key}"`, error);
    }
  }
}

/**
 * Prisma passes `contains` straight into ILIKE without escaping, so a search for `%` or `_`
 * would match every title. Postgres' default LIKE escape character is the backslash.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
