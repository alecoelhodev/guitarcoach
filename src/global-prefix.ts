import { RequestMethod } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';

// Shared by the running app (main.ts) and the OpenAPI generator
// (scripts/generate-openapi.ts) so the paths in the committed openapi.json
// match the routes the app actually serves — @nestjs/swagger's
// createDocument() picks up whatever setGlobalPrefix() was applied before it.
export function applyGlobalPrefix(
  app: INestApplication,
  apiPrefix: string,
  apiVersion: string,
): void {
  app.setGlobalPrefix(`${apiPrefix}/${apiVersion}`, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'auth', method: RequestMethod.ALL },
      { path: 'auth/*path', method: RequestMethod.ALL },
    ],
  });
}
