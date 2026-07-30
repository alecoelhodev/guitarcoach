import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Routine } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { FindRoutinesQueryDto } from './dto/find-routines-query.dto';
import { UpdateRoutineDto } from './dto/update-routine.dto';

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

function notFound(id: string): NotFoundException {
  return new NotFoundException(`Routine with id "${id}" not found`);
}

@Injectable()
export class RoutinesService {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, dto: CreateRoutineDto): Promise<Routine> {
    return this.prisma.routine.create({ data: { ...dto, userId } });
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
}
