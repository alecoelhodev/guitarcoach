import { assertSeedTargetIsLocal } from './seed-target';

const url = (host: string) =>
  `postgresql://user:pass@${host}:5432/guitar_coach?schema=public`;

describe('assertSeedTargetIsLocal', () => {
  it.each(['localhost', '127.0.0.1', '[::1]', 'postgres'])(
    'allows the local host %s',
    (host) => {
      expect(() =>
        assertSeedTargetIsLocal({ DATABASE_URL: url(host) }),
      ).not.toThrow();
    },
  );

  it('refuses a remote host', () => {
    expect(() =>
      assertSeedTargetIsLocal({
        DATABASE_URL: url('ep-example.eu-central-1.aws.neon.tech'),
      }),
    ).toThrow(/Refusing to seed a non-local database/);
  });

  it('refuses a host that only starts with a local name', () => {
    expect(() =>
      assertSeedTargetIsLocal({ DATABASE_URL: url('localhost.example.com') }),
    ).toThrow(/Refusing to seed/);
  });

  it('refuses an unparseable DATABASE_URL', () => {
    expect(() =>
      assertSeedTargetIsLocal({ DATABASE_URL: 'not a url' }),
    ).toThrow(/Refusing to seed/);
  });

  it('refuses when DATABASE_URL is unset', () => {
    expect(() => assertSeedTargetIsLocal({})).toThrow(
      /DATABASE_URL is not set/,
    );
  });

  it.each(['true', 'TRUE', '1', 'yes'])(
    'allows a remote host when SEED_ALLOW_NON_LOCAL=%s',
    (flag) => {
      expect(() =>
        assertSeedTargetIsLocal({
          DATABASE_URL: url('db.example.com'),
          SEED_ALLOW_NON_LOCAL: flag,
        }),
      ).not.toThrow();
    },
  );

  it('ignores an opt-in value that is not affirmative', () => {
    expect(() =>
      assertSeedTargetIsLocal({
        DATABASE_URL: url('db.example.com'),
        SEED_ALLOW_NON_LOCAL: 'false',
      }),
    ).toThrow(/Refusing to seed/);
  });
});
