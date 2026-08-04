import { getCurrentWeekStart, resolveWeekStart } from './week-boundary.util';

describe('getCurrentWeekStart', () => {
  it('returns the preceding Monday 00:00:00 UTC for a mid-week date', () => {
    // 2024-01-03 is a Wednesday; 2024-01-01 is the Monday of that week.
    const now = new Date('2024-01-03T15:30:00Z');

    expect(getCurrentWeekStart(now, 'UTC')).toEqual(
      new Date('2024-01-01T00:00:00.000Z'),
    );
  });

  it('returns the same day for a timestamp shortly after Monday midnight', () => {
    const now = new Date('2024-01-01T00:00:05Z');

    expect(getCurrentWeekStart(now, 'UTC')).toEqual(
      new Date('2024-01-01T00:00:00.000Z'),
    );
  });

  it('treats Sunday as still belonging to the preceding Monday-starting week', () => {
    const now = new Date('2024-01-07T23:59:00Z');

    expect(getCurrentWeekStart(now, 'UTC')).toEqual(
      new Date('2024-01-01T00:00:00.000Z'),
    );
  });

  it('normalizes correctly across a month boundary', () => {
    // 2024-03-03 is a Sunday; the Monday of that week is 2024-02-26.
    const now = new Date('2024-03-03T10:00:00Z');

    expect(getCurrentWeekStart(now, 'UTC')).toEqual(
      new Date('2024-02-26T00:00:00.000Z'),
    );
  });

  it('uses the target Monday\'s own UTC offset, not "now"\'s, across a DST transition', () => {
    // US DST began 2024-03-10 at 2am local (EST, UTC-5) -> 3am EDT (UTC-4).
    // "now" below is Sunday 2024-03-10 at 10:30am EDT (14:30 UTC), i.e.
    // already in EDT. The Monday of that same week, 2024-03-04, was still on
    // EST (UTC-5) since DST hadn't started yet — the correct answer must use
    // EST's offset for the Monday, not EDT's offset from "now".
    const now = new Date('2024-03-10T14:30:00Z');

    expect(getCurrentWeekStart(now, 'America/New_York')).toEqual(
      new Date('2024-03-04T05:00:00.000Z'),
    );
  });

  it('computes a timezone-aware week start once DST is in effect', () => {
    // 2024-03-13 is a Wednesday, already in EDT (UTC-4); the Monday of that
    // week, 2024-03-11, is also in EDT.
    const now = new Date('2024-03-13T12:00:00Z');

    expect(getCurrentWeekStart(now, 'America/New_York')).toEqual(
      new Date('2024-03-11T04:00:00.000Z'),
    );
  });
});

describe('resolveWeekStart', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the parsed override when CLEANUP_WEEK_START is set', () => {
    const weekStart = resolveWeekStart({
      timeZone: 'UTC',
      override: '2026-07-27T00:00:00Z',
    });

    expect(weekStart).toEqual(new Date('2026-07-27T00:00:00.000Z'));
  });

  it('throws a clear error when the override is not a valid date', () => {
    expect(() =>
      resolveWeekStart({ timeZone: 'UTC', override: 'not-a-date' }),
    ).toThrow('Invalid CLEANUP_WEEK_START value: "not-a-date"');
  });

  it('falls back to the current week start when no override is given', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-03T15:30:00Z'));

    const weekStart = resolveWeekStart({ timeZone: 'UTC' });

    expect(weekStart).toEqual(new Date('2024-01-01T00:00:00.000Z'));
  });
});
