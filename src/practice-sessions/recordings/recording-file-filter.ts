import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

export const ALLOWED_RECORDING_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/webm',
];

export function recordingFileFilter(
  _req: Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!ALLOWED_RECORDING_MIME_TYPES.includes(file.mimetype)) {
    callback(
      new BadRequestException(`Unsupported file type: ${file.mimetype}`),
      false,
    );
    return;
  }
  callback(null, true);
}
