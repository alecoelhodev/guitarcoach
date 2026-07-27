import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './types/user.type';
import { UsersRepository } from './users.repository';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  create(dto: CreateUserDto): User {
    const email = normalizeEmail(dto.email);

    if (this.usersRepository.findByEmail(email)) {
      throw new ConflictException('A user with this email already exists');
    }

    const now = new Date();
    const user: User = {
      id: randomUUID(),
      email,
      displayName: dto.displayName,
      createdAt: now,
      updatedAt: now,
    };

    return this.usersRepository.create(user);
  }

  findAll(): User[] {
    return this.usersRepository.findAll();
  }

  findById(id: string): User {
    const user = this.usersRepository.findById(id);

    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    return user;
  }

  update(id: string, dto: UpdateUserDto): User {
    const existing = this.findById(id);

    let email = existing.email;
    if (dto.email !== undefined) {
      email = normalizeEmail(dto.email);
      const other = this.usersRepository.findByEmail(email);
      if (other && other.id !== id) {
        throw new ConflictException('A user with this email already exists');
      }
    }

    const updated: User = {
      ...existing,
      email,
      displayName: dto.displayName ?? existing.displayName,
      updatedAt: new Date(),
    };

    return this.usersRepository.update(id, updated) as User;
  }

  remove(id: string): void {
    this.findById(id);
    this.usersRepository.delete(id);
  }
}
