import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { Routine, RoutineTask } from '../generated/prisma/client';
import { AddRoutineTaskDto } from './dto/add-routine-task.dto';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { FindRoutinesQueryDto } from './dto/find-routines-query.dto';
import { ReorderRoutineTasksDto } from './dto/reorder-routine-tasks.dto';
import { UpdateRoutineDto } from './dto/update-routine.dto';
import { UpdateRoutineTaskDto } from './dto/update-routine-task.dto';
import { PaginatedResult, RoutinesService } from './routines.service';

@Controller('routines')
export class RoutinesController {
  constructor(private readonly routinesService: RoutinesService) {}

  @Post()
  create(
    @Session() session: UserSession,
    @Body() createRoutineDto: CreateRoutineDto,
  ): Promise<Routine> {
    return this.routinesService.create(session.user.id, createRoutineDto);
  }

  @Get()
  findAll(
    @Session() session: UserSession,
    @Query() query: FindRoutinesQueryDto,
  ): Promise<PaginatedResult<Routine>> {
    return this.routinesService.findAll(session.user.id, query);
  }

  @Get(':id')
  findOne(
    @Session() session: UserSession,
    @Param('id') id: string,
  ): Promise<Routine> {
    return this.routinesService.findById(session.user.id, id);
  }

  @Patch(':id')
  update(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() updateRoutineDto: UpdateRoutineDto,
  ): Promise<Routine> {
    return this.routinesService.update(session.user.id, id, updateRoutineDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Session() session: UserSession,
    @Param('id') id: string,
  ): Promise<void> {
    return this.routinesService.remove(session.user.id, id);
  }

  @Post(':routineId/tasks')
  addTask(
    @Session() session: UserSession,
    @Param('routineId') routineId: string,
    @Body() addRoutineTaskDto: AddRoutineTaskDto,
  ): Promise<RoutineTask> {
    return this.routinesService.addTask(
      session.user.id,
      routineId,
      addRoutineTaskDto,
    );
  }

  @Patch(':routineId/tasks/reorder')
  reorderTasks(
    @Session() session: UserSession,
    @Param('routineId') routineId: string,
    @Body() reorderRoutineTasksDto: ReorderRoutineTasksDto,
  ): Promise<RoutineTask[]> {
    return this.routinesService.reorderTasks(
      session.user.id,
      routineId,
      reorderRoutineTasksDto,
    );
  }

  @Patch(':routineId/tasks/:taskId')
  updateTask(
    @Session() session: UserSession,
    @Param('routineId') routineId: string,
    @Param('taskId') taskId: string,
    @Body() updateRoutineTaskDto: UpdateRoutineTaskDto,
  ): Promise<RoutineTask> {
    return this.routinesService.updateTask(
      session.user.id,
      routineId,
      taskId,
      updateRoutineTaskDto,
    );
  }

  @Delete(':routineId/tasks/:taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeTask(
    @Session() session: UserSession,
    @Param('routineId') routineId: string,
    @Param('taskId') taskId: string,
  ): Promise<void> {
    return this.routinesService.removeTask(session.user.id, routineId, taskId);
  }
}
