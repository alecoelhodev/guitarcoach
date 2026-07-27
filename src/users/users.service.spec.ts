import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, UsersRepository],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('create', () => {
    it('creates a user with a generated id and timestamps', () => {
      const user = service.create({
        email: 'alex@example.com',
        displayName: 'Alex',
      });

      expect(user.id).toEqual(expect.any(String));
      expect(user.email).toBe('alex@example.com');
      expect(user.displayName).toBe('Alex');
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it('normalizes email by trimming and lowercasing', () => {
      const user = service.create({
        email: '  Alex@Example.COM  ',
        displayName: 'Alex',
      });

      expect(user.email).toBe('alex@example.com');
    });

    it('rejects a duplicate email with ConflictException', () => {
      service.create({ email: 'alex@example.com', displayName: 'Alex' });

      expect(() =>
        service.create({ email: 'ALEX@example.com', displayName: 'Other' }),
      ).toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('returns all created users', () => {
      service.create({ email: 'a@example.com', displayName: 'A' });
      service.create({ email: 'b@example.com', displayName: 'B' });

      expect(service.findAll()).toHaveLength(2);
    });
  });

  describe('findById', () => {
    it('returns the matching user', () => {
      const created = service.create({
        email: 'alex@example.com',
        displayName: 'Alex',
      });

      expect(service.findById(created.id)).toEqual(created);
    });

    it('throws NotFoundException for an unknown id', () => {
      expect(() => service.findById('unknown-id')).toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates the display name and preserves createdAt', () => {
      const created = service.create({
        email: 'alex@example.com',
        displayName: 'Alex',
      });

      const updated = service.update(created.id, { displayName: 'Alexson' });

      expect(updated.displayName).toBe('Alexson');
      expect(updated.createdAt).toEqual(created.createdAt);
    });

    it('bumps updatedAt on change', () => {
      const created = service.create({
        email: 'alex@example.com',
        displayName: 'Alex',
      });
      const originalUpdatedAt = created.updatedAt;

      const updated = service.update(created.id, { displayName: 'Alexson' });

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt.getTime(),
      );
    });

    it('normalizes email on update', () => {
      const created = service.create({
        email: 'alex@example.com',
        displayName: 'Alex',
      });

      const updated = service.update(created.id, {
        email: '  Alex2@Example.COM ',
      });

      expect(updated.email).toBe('alex2@example.com');
    });

    it('throws NotFoundException for an unknown id', () => {
      expect(() => service.update('unknown-id', { displayName: 'X' })).toThrow(
        NotFoundException,
      );
    });

    it('rejects updating to another user email with ConflictException', () => {
      service.create({ email: 'a@example.com', displayName: 'A' });
      const userB = service.create({
        email: 'b@example.com',
        displayName: 'B',
      });

      expect(() =>
        service.update(userB.id, { email: 'a@example.com' }),
      ).toThrow(ConflictException);
    });

    it('allows updating a user to its own current email', () => {
      const created = service.create({
        email: 'alex@example.com',
        displayName: 'Alex',
      });

      expect(() =>
        service.update(created.id, { email: 'alex@example.com' }),
      ).not.toThrow();
    });
  });

  describe('remove', () => {
    it('deletes an existing user', () => {
      const created = service.create({
        email: 'alex@example.com',
        displayName: 'Alex',
      });

      service.remove(created.id);

      expect(() => service.findById(created.id)).toThrow(NotFoundException);
    });

    it('throws NotFoundException for an unknown id', () => {
      expect(() => service.remove('unknown-id')).toThrow(NotFoundException);
    });
  });
});
