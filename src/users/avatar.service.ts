import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { EnvironmentVariables } from '../config/env.validation';
import { GcpStorageService } from '../gcp-storage/gcp-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { AvatarUrlResponseDto } from './dto/avatar-response.dto';

export const AVATAR_MAX_SIZE_BYTES = 2 * 1024 * 1024;

export const AVATAR_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * better-auth's own `update-user` route lets a client write `User.image`, so
 * the column can't be trusted to name one of this user's objects. Anything
 * outside their avatar prefix is treated as no avatar: never signed, never
 * deleted.
 */
export function ownAvatarObject(
  userId: string,
  image: string | null,
): string | null {
  return image?.startsWith(`users/${userId}/avatar/`) ? image : null;
}

function noAvatar(): NotFoundException {
  return new NotFoundException('No profile photo is set');
}

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gcpStorage: GcpStorageService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async upload(
    userId: string,
    file: Express.Multer.File,
  ): Promise<AvatarUrlResponseDto> {
    const previous = await this.currentImage(userId);
    const objectName = `users/${userId}/avatar/${randomUUID()}.${AVATAR_EXTENSIONS[file.mimetype]}`;

    await this.gcpStorage.uploadObject(objectName, file.buffer, file.mimetype);

    // Compare-and-swap on the value read above: a concurrent upload that won
    // the race would otherwise have its object orphaned by this write.
    const { count } = await this.prisma.user
      .updateMany({
        where: { id: userId, image: previous },
        data: { image: objectName },
      })
      .catch(async (error: unknown) => {
        await this.deleteQuietly(objectName);
        throw error;
      });
    if (count === 0) {
      await this.deleteQuietly(objectName);
      throw new ConflictException(
        'Your profile photo changed while uploading. Try again.',
      );
    }

    const previousObject = ownAvatarObject(userId, previous);
    if (previousObject) await this.deleteQuietly(previousObject);

    return this.signedUrl(objectName);
  }

  async getUrl(userId: string): Promise<AvatarUrlResponseDto> {
    const objectName = ownAvatarObject(userId, await this.currentImage(userId));
    if (!objectName) throw noAvatar();

    return this.signedUrl(objectName);
  }

  async remove(userId: string): Promise<void> {
    const image = await this.currentImage(userId);
    if (image === null) throw noAvatar();

    await this.prisma.user.updateMany({
      where: { id: userId, image },
      data: { image: null },
    });

    const objectName = ownAvatarObject(userId, image);
    if (objectName) await this.deleteQuietly(objectName);
  }

  private async currentImage(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { image: true },
    });
    if (!user) throw new NotFoundException(`User "${userId}" not found`);

    return user.image;
  }

  private async signedUrl(objectName: string): Promise<AvatarUrlResponseDto> {
    const expiresInSeconds = this.configService.get(
      'RECORDING_DOWNLOAD_URL_EXPIRY_SECONDS',
      { infer: true },
    );
    const url = await this.gcpStorage.getSignedDownloadUrl(
      objectName,
      expiresInSeconds,
    );

    return { url };
  }

  private async deleteQuietly(objectName: string): Promise<void> {
    try {
      await this.gcpStorage.deleteObject(objectName);
    } catch (error) {
      this.logger.error(`Orphaned avatar object "${objectName}"`, error);
    }
  }
}
