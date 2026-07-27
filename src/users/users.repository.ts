import { Injectable } from '@nestjs/common';
import { User } from './types/user.type';

function cloneUser(user: User): User {
  return { ...user };
}

@Injectable()
export class UsersRepository {
  private readonly users = new Map<string, User>();

  create(user: User): User {
    this.users.set(user.id, cloneUser(user));
    return cloneUser(user);
  }

  findAll(): User[] {
    return Array.from(this.users.values()).map(cloneUser);
  }

  findById(id: string): User | null {
    const user = this.users.get(id);
    return user ? cloneUser(user) : null;
  }

  findByEmail(email: string): User | null {
    const user = Array.from(this.users.values()).find(
      (candidate) => candidate.email === email,
    );
    return user ? cloneUser(user) : null;
  }

  update(id: string, user: User): User | null {
    if (!this.users.has(id)) {
      return null;
    }
    this.users.set(id, cloneUser(user));
    return cloneUser(user);
  }

  delete(id: string): boolean {
    return this.users.delete(id);
  }
}
