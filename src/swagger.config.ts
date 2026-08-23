import { DocumentBuilder } from '@nestjs/swagger';

export function buildSwaggerConfig(apiVersion: string) {
  return new DocumentBuilder()
    .setTitle('Guitar Coach API')
    .setDescription('API documentation for the Guitar Coach backend')
    .setVersion(apiVersion)
    .build();
}
