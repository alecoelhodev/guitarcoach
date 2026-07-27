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
        email: 'jordan@example.com',
        displayName: 'Jordan',
      });

      expect(user.id).toEqual(expect.any(String));
      expect(user.email).toBe('jordan@example.com');
      expect(user.displayName).toBe('Jordan');
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it('normalizes email by trimming and lowercasing', () => {
      const user = service.create({
        email: '  Jordan@Example.COM  ',
        displayName: 'Jordan',
      });

      expect(user.email).toBe('jordan@example.com');
    });

    it('rejects a duplicate email with ConflictException', () => {
      service.create({ email: 'jordan@example.com', displayName: 'Jordan' });

      expect(() =>
        service.create({ email: 'JORDAN@example.com', displayName: 'Other' }),
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
        email: 'jordan@example.com',
        displayName: 'Jordan',
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
        email: 'jordan@example.com',
        displayName: 'Jordan',
      });

      const updated = service.update(created.id, {
        displayName: 'Jordan Casey',
      });

      expect(updated.displayName).toBe('Jordan Casey');
      expect(updated.createdAt).toEqual(created.createdAt);
    });

    it('bumps updatedAt on change', () => {
      const created = service.create({
        email: 'jordan@example.com',
        displayName: 'Jordan',
      });
      const originalUpdatedAt = created.updatedAt;

      const updated = service.update(created.id, {
        displayName: 'Jordan Casey',
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt.getTime(),
      );
    });

    it('normalizes email on update', () => {
      const created = service.create({
        email: 'jordan@example.com',
        displayName: 'Jordan',
      });

      const updated = service.update(created.id, {
        email: '  Jordan2@Example.COM ',
      });

      expect(updated.email).toBe('jordan2@example.com');
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
        email: 'jordan@example.com',
        displayName: 'Jordan',
      });

      expect(() =>
        service.update(created.id, { email: 'jordan@example.com' }),
      ).not.toThrow();
    });
  });

  describe('remove', () => {
    it('deletes an existing user', () => {
      const created = service.create({
        email: 'jordan@example.com',
        displayName: 'Jordan',
      });

      service.remove(created.id);

      expect(() => service.findById(created.id)).toThrow(NotFoundException);
    });

    it('throws NotFoundException for an unknown id', () => {
      expect(() => service.remove('unknown-id')).toThrow(NotFoundException);
    });
  });
});
