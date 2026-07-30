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
import { Routine } from '../generated/prisma/client';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { FindRoutinesQueryDto } from './dto/find-routines-query.dto';
import { UpdateRoutineDto } from './dto/update-routine.dto';
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
}
