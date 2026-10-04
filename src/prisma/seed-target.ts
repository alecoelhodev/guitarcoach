// Hosts a developer's own database can live on: loopback, plus the
// `postgres` service name compose.yaml gives the API container.
const LOCAL_DATABASE_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  'postgres',
]);

const OPT_IN_VALUES = new Set(['1', 'true', 'yes']);

function isLocalDatabaseUrl(databaseUrl: string): boolean {
  try {
    return LOCAL_DATABASE_HOSTS.has(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * Throws unless the seed would write to a local database, or the caller
 * explicitly opted in with `SEED_ALLOW_NON_LOCAL=true`. The seed creates an
 * admin and four users sharing one password committed to a public repo, so
 * it must never reach a shared or production database by accident.
 */
export function assertSeedTargetIsLocal(env: NodeJS.ProcessEnv): void {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Add it to .env (see .env.example).',
    );
  }

  const allowNonLocal = OPT_IN_VALUES.has(
    (env.SEED_ALLOW_NON_LOCAL ?? '').toLowerCase(),
  );
  if (!isLocalDatabaseUrl(databaseUrl) && !allowNonLocal) {
    throw new Error(
      'Refusing to seed a non-local database. The seed creates accounts ' +
        '(including an admin) whose shared password is public, so it only ' +
        'runs against localhost or the Compose `postgres` service. Never seed ' +
        'production. If you really intend to seed this database, set ' +
        'SEED_ALLOW_NON_LOCAL=true.',
    );
  }
}
