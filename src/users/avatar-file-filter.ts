import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { AVATAR_EXTENSIONS } from './avatar.service';

export function avatarFileFilter(
  _req: Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!Object.hasOwn(AVATAR_EXTENSIONS, file.mimetype)) {
    callback(
      new BadRequestException(
        'Use a JPEG, PNG or WebP image for your profile photo.',
      ),
      false,
    );
    return;
  }
  callback(null, true);
}
