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
import { Roles } from '@thallesp/nestjs-better-auth';
import { CreateTaskDto } from './dto/create-task.dto';
import { FindTasksQueryDto } from './dto/find-tasks-query.dto';
import {
  PaginatedTasksResponseDto,
  TaskResponseDto,
} from './dto/task-response.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @Roles(['admin'])
  create(@Body() createTaskDto: CreateTaskDto): Promise<TaskResponseDto> {
    return this.tasksService.create(createTaskDto);
  }

  @Get()
  findAll(
    @Query() query: FindTasksQueryDto,
  ): Promise<PaginatedTasksResponseDto> {
    return this.tasksService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<TaskResponseDto> {
    return this.tasksService.findById(id);
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
