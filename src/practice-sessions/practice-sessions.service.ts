import { Injectable, NotFoundException } from '@nestjs/common';
import { PracticeSession } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePracticeSessionDto } from './dto/create-practice-session.dto';

function notFound(id: string): NotFoundException {
  return new NotFoundException(`Practice session with id "${id}" not found`);
}

@Injectable()
export class PracticeSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    userId: string,
    dto: CreatePracticeSessionDto,
  ): Promise<PracticeSession> {
    return this.prisma.practiceSession.create({ data: { ...dto, userId } });
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
}
