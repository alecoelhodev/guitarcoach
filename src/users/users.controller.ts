import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles, Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { memoryStorage } from 'multer';
import { avatarFileFilter } from './avatar-file-filter';
import { AVATAR_MAX_SIZE_BYTES, AvatarService } from './avatar.service';
import { AvatarUrlResponseDto } from './dto/avatar-response.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { MeResponseDto, UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly avatarService: AvatarService,
  ) {}

  @Get('me')
  me(@Session() session: UserSession): MeResponseDto {
    return session.user;
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMe(@Session() session: UserSession): Promise<void> {
    return this.usersService.deleteAccount(session.user.id);
  }

  @Put('me/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: AVATAR_MAX_SIZE_BYTES },
      fileFilter: avatarFileFilter,
    }),
  )
  uploadAvatar(
    @Session() session: UserSession,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<AvatarUrlResponseDto> {
    if (!file) {
      throw new BadRequestException('No file was uploaded');
    }

    return this.avatarService.upload(session.user.id, file);
  }

  @Get('me/avatar')
  getAvatar(@Session() session: UserSession): Promise<AvatarUrlResponseDto> {
    return this.avatarService.getUrl(session.user.id);
  }

  @Delete('me/avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAvatar(@Session() session: UserSession): Promise<void> {
    return this.avatarService.remove(session.user.id);
  }

  @Get()
  @Roles(['admin'])
  findAll(): Promise<UserResponseDto[]> {
    return this.usersService.findAll();
  }

  @Get(':id')
  @Roles(['admin'])
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  @Roles(['admin'])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @Roles(['admin'])
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.usersService.remove(session.user.id, id);
  }
}
