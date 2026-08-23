export class RecordingResponseDto {
  id: string;
  userId: string;
  practiceSessionId: string;
  objectName: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}

export class DownloadUrlResponseDto {
  url: string;
}
