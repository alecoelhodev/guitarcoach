import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PracticeSession } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RoutinesService } from '../routines/routines.service';
import { CreatePracticeSessionDto } from './dto/create-practice-session.dto';

const PRISMA_ERROR_FOREIGN_KEY_CONSTRAINT = 'P2003';

function isPrismaErrorCode(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function notFound(id: string): NotFoundException {
  return new NotFoundException(`Practice session with id "${id}" not found`);
}

export type PracticeSessionWithTasks = Prisma.PracticeSessionGetPayload<{
  include: {
    routine: { select: { id: true; title: true } };
    sessionTasks: { include: { task: { select: { id: true; title: true } } } };
  };
}>;

export interface TaskStat {
  taskId: string;
  title: string;
  timesPracticedRecently: number;
  totalMinutesPracticedRecently: number;
  lastPracticedAt: string | null;
  timesPracticedAllTime: number;
}

const RECENT_INCLUDE = {
  routine: { select: { id: true, title: true } },
  sessionTasks: { include: { task: { select: { id: true, title: true } } } },
} as const;

@Injectable()
export class PracticeSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly routinesService: RoutinesService,
  ) {}

  async create(
    userId: string,
    dto: CreatePracticeSessionDto,
  ): Promise<PracticeSession> {
    const { routineId, tasks, ...rest } = dto;

    // Ownership check reused from RoutinesService rather than reimplemented
    // here -- a routineId belonging to another user must 404, never 403.
    if (routineId) {
      await this.routinesService.findById(userId, routineId);
    }

    try {
      return await this.prisma.practiceSession.create({
        data: {
          ...rest,
          userId,
          routineId,
          ...(tasks && {
            sessionTasks: {
              create: tasks.map((task) => ({
                taskId: task.taskId,
                durationMinutes: task.durationMinutes,
                completed: task.completed,
              })),
            },
          }),
        },
      });
    } catch (error) {
      if (isPrismaErrorCode(error, PRISMA_ERROR_FOREIGN_KEY_CONSTRAINT)) {
        throw new NotFoundException('One or more tasks were not found');
      }
      throw error;
    }
  }

  findAll(userId: string): Promise<PracticeSession[]> {
    return this.prisma.practiceSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(userId: string, id: string): Promise<PracticeSession> {
    const session = await this.prisma.practiceSession.findFirst({
      where: { id, userId },
    });

    if (!session) {
      throw notFound(id);
    }

    return session;
  }

  findRecent(
    userId: string,
    days: number,
  ): Promise<PracticeSessionWithTasks[]> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    return this.prisma.practiceSession.findMany({
      where: { userId, createdAt: { gte: cutoff } },
      orderBy: { createdAt: 'desc' },
      include: RECENT_INCLUDE,
    });
  }

  // Deterministic aggregation over PracticeSessionTask, the stronger signal
  // for "what was actually practiced" per the RoutineCoachAgent spec.
  // lastPracticedAt/timesPracticedAllTime are intentionally NOT bounded by
  // `days` -- a task last touched outside the window is exactly the
  // "neglected" signal the agent needs; a task absent from the result
  // entirely was never practiced. No ranking/"least recently practiced"
  // logic here -- that comparison is left to the LLM.
  async getTaskStats(userId: string, days: number): Promise<TaskStat[]> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.practiceSessionTask.findMany({
      where: { practiceSession: { userId } },
      include: { task: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const byTask = new Map<string, TaskStat>();

    for (const row of rows) {
      const stat = byTask.get(row.taskId) ?? {
        taskId: row.taskId,
        title: row.task.title,
        timesPracticedRecently: 0,
        totalMinutesPracticedRecently: 0,
        lastPracticedAt: null,
        timesPracticedAllTime: 0,
      };

      stat.timesPracticedAllTime += 1;
      stat.lastPracticedAt ??= row.createdAt.toISOString();

      if (row.createdAt >= cutoff) {
        stat.timesPracticedRecently += 1;
        stat.totalMinutesPracticedRecently += row.durationMinutes ?? 0;
      }

      byTask.set(row.taskId, stat);
    }

    return [...byTask.values()];
  }
}
