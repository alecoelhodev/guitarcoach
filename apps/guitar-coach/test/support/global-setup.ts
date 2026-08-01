import { execSync } from 'node:child_process';
import dotenv from 'dotenv';
import { expand } from 'dotenv-expand';
import { Client } from 'pg';

// Only letters/digits/underscore, not starting with a digit — Postgres
// database names can't be parameterized in CREATE DATABASE, so this is
// validated before being interpolated into the SQL statement below.
const SAFE_DATABASE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const dbName = url.pathname.replace(/^\//, '');
  if (!SAFE_DATABASE_NAME.test(dbName)) {
    throw new Error(`Unsafe database name in TEST_DATABASE_URL: "${dbName}"`);
  }

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );
    if (rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await client.end();
  }
}

// Runs the e2e suite against a disposable database instead of the dev
// DATABASE_URL, since every e2e spec's beforeEach wipes its tables — without
// this, `npm run test:e2e` silently destroys local dev data.
export default async function globalSetup(): Promise<void> {
  expand(dotenv.config());

  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Add it to .env (see .env.example) before running e2e tests.',
    );
  }

  await ensureDatabaseExists(testDatabaseUrl);

  process.env.DATABASE_URL = testDatabaseUrl;
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
}
