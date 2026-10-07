import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { GcpStorageService } from '../gcp-storage/gcp-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { AvatarService, ownAvatarObject } from './avatar.service';

const USER_ID = 'u1';
const OWN = 'users/u1/avatar/old.jpg';

function buildFile(mimetype = 'image/png'): Express.Multer.File {
  return {
    buffer: Buffer.from('img'),
    mimetype,
    originalname: 'me.png',
    size: 3,
  } as Express.Multer.File;
}

describe('AvatarService', () => {
  let service: AvatarService;
  let prisma: {
    user: { findUnique: jest.Mock; updateMany: jest.Mock };
  };
  let gcpStorage: {
    uploadObject: jest.Mock;
    deleteObject: jest.Mock;
    getSignedDownloadUrl: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ image: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    gcpStorage = {
      uploadObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AvatarService,
        { provide: PrismaService, useValue: prisma },
        { provide: GcpStorageService, useValue: gcpStorage },
        { provide: ConfigService, useValue: { get: jest.fn(() => 900) } },
      ],
    }).compile();

    service = module.get(AvatarService);
  });

  describe('ownAvatarObject', () => {
    it('accepts only objects under the user’s own avatar prefix', () => {
      expect(ownAvatarObject('u1', OWN)).toBe(OWN);
      expect(ownAvatarObject('u1', 'users/u2/avatar/x.jpg')).toBeNull();
      expect(ownAvatarObject('u1', 'https://example.com/a.png')).toBeNull();
      expect(ownAvatarObject('u1', null)).toBeNull();
    });
  });

  describe('upload', () => {
    it('stores the object under the user’s prefix with an extension from the MIME type', async () => {
      await expect(service.upload(USER_ID, buildFile())).resolves.toEqual({
        url: 'https://signed',
      });

      const [objectName, , contentType] = gcpStorage.uploadObject.mock
        .calls[0] as [string, Buffer, string];
      expect(objectName).toMatch(/^users\/u1\/avatar\/[0-9a-f-]{36}\.png$/);
      expect(contentType).toBe('image/png');
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: USER_ID, image: null },
        data: { image: objectName },
      });
      expect(gcpStorage.getSignedDownloadUrl).toHaveBeenCalledWith(
        objectName,
        900,
      );
    });

    it('deletes the previous avatar after the new one is saved', async () => {
      prisma.user.findUnique.mockResolvedValue({ image: OWN });

      await service.upload(USER_ID, buildFile('image/jpeg'));

      expect(gcpStorage.deleteObject).toHaveBeenCalledWith(OWN);
      expect(
        gcpStorage.deleteObject.mock.invocationCallOrder[0],
      ).toBeGreaterThan(prisma.user.updateMany.mock.invocationCallOrder[0]);
    });

    it('never deletes a previous image outside the user’s prefix', async () => {
      prisma.user.findUnique.mockResolvedValue({
        image: 'users/u2/avatar/x.jpg',
      });

      await service.upload(USER_ID, buildFile());

      expect(gcpStorage.deleteObject).not.toHaveBeenCalled();
    });

    it('removes the new object and reports a conflict when a concurrent upload won', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.upload(USER_ID, buildFile())).rejects.toThrow(
        ConflictException,
      );
      const [uploaded] = gcpStorage.uploadObject.mock.calls[0] as [string];
      expect(gcpStorage.deleteObject).toHaveBeenCalledWith(uploaded);
    });

    it('removes the new object when the database write fails', async () => {
      prisma.user.updateMany.mockRejectedValue(new Error('db down'));

      await expect(service.upload(USER_ID, buildFile())).rejects.toThrow(
        'db down',
      );
      const [uploaded] = gcpStorage.uploadObject.mock.calls[0] as [string];
      expect(gcpStorage.deleteObject).toHaveBeenCalledWith(uploaded);
    });

    it('still succeeds when the previous object cannot be deleted', async () => {
      prisma.user.findUnique.mockResolvedValue({ image: OWN });
      gcpStorage.deleteObject.mockRejectedValue(new Error('gcs down'));

      await expect(service.upload(USER_ID, buildFile())).resolves.toEqual({
        url: 'https://signed',
      });
    });
  });

  describe('getUrl', () => {
    it('signs the user’s own avatar', async () => {
      prisma.user.findUnique.mockResolvedValue({ image: OWN });

      await expect(service.getUrl(USER_ID)).resolves.toEqual({
        url: 'https://signed',
      });
      expect(gcpStorage.getSignedDownloadUrl).toHaveBeenCalledWith(OWN, 900);
    });

    it('404s when no avatar is set', async () => {
      await expect(service.getUrl(USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('404s rather than signing another user’s object', async () => {
      prisma.user.findUnique.mockResolvedValue({
        image: 'users/u2/avatar/x.jpg',
      });

      await expect(service.getUrl(USER_ID)).rejects.toThrow(NotFoundException);
      expect(gcpStorage.getSignedDownloadUrl).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('clears the column, then deletes the object', async () => {
      prisma.user.findUnique.mockResolvedValue({ image: OWN });

      await service.remove(USER_ID);

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: USER_ID, image: OWN },
        data: { image: null },
      });
      expect(gcpStorage.deleteObject).toHaveBeenCalledWith(OWN);
    });

    it('clears a foreign value without deleting its object', async () => {
      prisma.user.findUnique.mockResolvedValue({
        image: 'users/u2/avatar/x.jpg',
      });

      await service.remove(USER_ID);

      expect(prisma.user.updateMany).toHaveBeenCalled();
      expect(gcpStorage.deleteObject).not.toHaveBeenCalled();
    });

    it('404s when no avatar is set', async () => {
      await expect(service.remove(USER_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
