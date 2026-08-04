const WEEKDAY_OFFSET_FROM_MONDAY: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function getDatePartsInTimeZone(
  instant: Date,
  timeZone: string,
): DateParts & { weekday: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday,
  };
}

// Converts a Y-M-D midnight, as it would read on a wall clock in `timeZone`,
// into the UTC instant it actually represents — by taking a naive UTC guess,
// checking how that guess reads back in `timeZone`, and correcting for the
// difference. This accounts for that zone's offset (including DST) on that
// date. For timeZone: 'UTC' the offset is always 0, so it reduces to
// Date.UTC(year, month - 1, day).
function zonedMidnightToUtc(
  { year, month, day }: DateParts,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(utcGuess))
      .map((part) => [part.type, part.value]),
  );
  // Some environments render midnight as hour "24" instead of "00".
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = utcGuess - asIfUtc;

  return new Date(utcGuess + offsetMs);
}

/**
 * Returns the UTC instant corresponding to 00:00:00 on the Monday of the
 * week containing `now`, as observed in `timeZone`.
 */
export function getCurrentWeekStart(now: Date, timeZone: string): Date {
  const { year, month, day, weekday } = getDatePartsInTimeZone(now, timeZone);
  const daysSinceMonday = WEEKDAY_OFFSET_FROM_MONDAY[weekday];

  if (daysSinceMonday === undefined) {
    throw new Error(`Unrecognized weekday abbreviation: "${weekday}"`);
  }

  // Calendar-only subtraction, anchored in UTC so month/year rollovers (e.g.
  // the 1st of the month falling on a Wednesday) normalize automatically —
  // this is not yet a real timezone conversion, just date arithmetic.
  const mondayCalendarGuess = new Date(
    Date.UTC(year, month - 1, day - daysSinceMonday),
  );
  const monday = getDatePartsInTimeZone(mondayCalendarGuess, 'UTC');

  return zonedMidnightToUtc(monday, timeZone);
}

export interface ResolveWeekStartOptions {
  timeZone: string;
  override?: string;
}

/**
 * Resolves the archiving cutoff: an explicit CLEANUP_WEEK_START override (for
 * manual reruns/local testing) if provided, otherwise the current week's
 * Monday 00:00:00 in `timeZone`.
 */
export function resolveWeekStart({
  timeZone,
  override,
}: ResolveWeekStartOptions): Date {
  if (override === undefined) {
    return getCurrentWeekStart(new Date(), timeZone);
  }

  const parsed = new Date(override);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid CLEANUP_WEEK_START value: "${override}"`);
  }

  return parsed;
}
