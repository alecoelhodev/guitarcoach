import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles, Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { BulkCreateTasksDto } from './dto/bulk-create-tasks.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { FindTasksQueryDto } from './dto/find-tasks-query.dto';
import {
  PaginatedTasksResponseDto,
  TaskResponseDto,
} from './dto/task-response.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

/** Mirrors the auth guard's @Roles check: the admin plugin may store several roles, comma-separated. */
function isAdmin(user: { role?: string | string[] | null }): boolean {
  const roles = Array.isArray(user.role)
    ? user.role
    : (user.role ?? '').split(',');
  return roles.some((role) => role.trim() === 'admin');
}

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  // Open to everyone: an admin's task joins the shared library, anyone else's is private to them.
  @Post()
  create(
    @Body() createTaskDto: CreateTaskDto,
    @Session() session: UserSession,
  ): Promise<TaskResponseDto> {
    return isAdmin(session.user)
      ? this.tasksService.create(createTaskDto)
      : this.tasksService.createPrivate(session.user.id, createTaskDto);
  }

  // The AI task generator's "Create N tasks": one round trip, all or nothing.
  @Post('bulk')
  @Roles(['admin'])
  createMany(@Body() dto: BulkCreateTasksDto): Promise<TaskResponseDto[]> {
    return this.tasksService.createMany(dto.tasks);
  }

  @Get()
  findAll(
    @Query() query: FindTasksQueryDto,
  ): Promise<PaginatedTasksResponseDto> {
    return this.tasksService.findAll(query);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ): Promise<TaskResponseDto> {
    return this.tasksService.findById(id, session.user.id);
  }

  @Patch(':id')
  @Roles(['admin'])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTaskDto: UpdateTaskDto,
  ): Promise<TaskResponseDto> {
    return this.tasksService.update(id, updateTaskDto);
  }

  @Delete(':id')
  @Roles(['admin'])
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.tasksService.remove(id);
  }
}
