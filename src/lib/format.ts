/**
 * Display formatting. Storage is UTC everywhere; rendering is Asia/Colombo
 * (UTC+5:30) per the project rules.
 */

const DISPLAY_TIME_ZONE = "Asia/Colombo";

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "22 Jun 2026, 09:14" in Asia/Colombo. */
export function formatDateTime(value: Date | string): string {
  return dateTimeFormatter.format(new Date(value)).replace(" at ", ", ");
}

/** "09:14" in Asia/Colombo. */
export function formatTime(value: Date | string): string {
  return timeFormatter.format(new Date(value));
}

/** "2,480 L" — liters with thousands separators. */
export function formatLiters(liters: number): string {
  return `${liters.toLocaleString("en-US", { maximumFractionDigits: 2 })} L`;
}

const COLOMBO_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

/**
 * UTC instant of midnight in Asia/Colombo for the day containing `now`.
 * Storage stays UTC; "today" on operator screens means the Colombo day.
 */
export function startOfColomboDay(now: Date): Date {
  const shifted = new Date(now.getTime() + COLOMBO_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - COLOMBO_OFFSET_MS);
}

// ---------------------------------------------------------------------------
// Quota display
// ---------------------------------------------------------------------------

const QUOTA_PERIOD_ADVERB = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly" } as const;
const QUOTA_PERIOD_NOUN = { DAILY: "day", WEEKLY: "week", MONTHLY: "month" } as const;

/** "500 L / daily" — a quota pair is always rendered as one unit. */
export function formatQuotaPair(liters: number, period: QuotaPeriodName): string {
  return `${formatLiters(liters)} / ${QUOTA_PERIOD_ADVERB[period]}`;
}

/** "week" for "this week" phrasing on the operator quota line. */
export function quotaPeriodNoun(period: QuotaPeriodName): string {
  return QUOTA_PERIOD_NOUN[period];
}

export const QUOTA_SOURCE_LABEL = {
  VEHICLE_CUSTOM: "custom",
  COMPANY_DEFAULT: "company default",
  TYPE_DEFAULT: "vehicle-type default",
  GLOBAL_DEFAULT: "global default",
} as const;

export type QuotaSourceName = keyof typeof QUOTA_SOURCE_LABEL;

/**
 * Resolved effective quota with amount, period, AND source — required
 * everywhere the hierarchy could otherwise be ambiguous, e.g.
 * "300 L / daily (vehicle-type default)" / "None (exempt)" / "None (unlimited)".
 */
export function formatEffectiveQuota(input: {
  status: "QUOTA" | "EXEMPT" | "UNLIMITED" | "DISABLED";
  liters: number | null;
  period: QuotaPeriodName | null;
  source: QuotaSourceName | null;
}): string {
  if (input.status === "EXEMPT") return "None (exempt)";
  if (input.status === "QUOTA" && input.liters !== null && input.period !== null) {
    const source = input.source !== null ? ` (${QUOTA_SOURCE_LABEL[input.source]})` : "";
    return `${formatQuotaPair(input.liters, input.period)}${source}`;
  }
  return "None (unlimited)";
}

// ---------------------------------------------------------------------------
// Quota period windows (Asia/Colombo — no DST, so day arithmetic is safe)
// ---------------------------------------------------------------------------

/** Mirrors the Prisma enums; string unions keep this module client-safe. */
export type WeekStartDayName =
  "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";

export type QuotaPeriodName = "DAILY" | "WEEKLY" | "MONTHLY";

/** JS Date.getUTCDay() numbering: Sunday = 0 … Saturday = 6. */
const WEEKDAY_NUMBER: Record<WeekStartDayName, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

/**
 * UTC instant of the most recent configured week-start (default Monday)
 * at midnight Asia/Colombo, for the week containing `now`.
 */
export function startOfColomboWeek(now: Date, weekStartDay: WeekStartDayName = "MONDAY"): Date {
  const dayStart = startOfColomboDay(now);
  const shifted = new Date(dayStart.getTime() + COLOMBO_OFFSET_MS);
  const daysBack = (shifted.getUTCDay() - WEEKDAY_NUMBER[weekStartDay] + 7) % 7;
  return new Date(dayStart.getTime() - daysBack * DAY_MS);
}

/** UTC instant of midnight Asia/Colombo on the 1st of the month containing `now`. */
export function startOfColomboMonth(now: Date): Date {
  const shifted = new Date(now.getTime() + COLOMBO_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCDate(1);
  return new Date(shifted.getTime() - COLOMBO_OFFSET_MS);
}

/**
 * The CURRENT window of a quota period: DAILY = since Colombo midnight,
 * WEEKLY = since the configured week-start day, MONTHLY = since the 1st.
 * `end` is exclusive. Consumption is always measured inside this window —
 * derived from the ledger, never a stored counter.
 */
export function currentColomboWindow(
  period: QuotaPeriodName,
  now: Date,
  weekStartDay: WeekStartDayName = "MONDAY",
): { start: Date; end: Date } {
  switch (period) {
    case "DAILY": {
      const start = startOfColomboDay(now);
      return { start, end: new Date(start.getTime() + DAY_MS) };
    }
    case "WEEKLY": {
      const start = startOfColomboWeek(now, weekStartDay);
      return { start, end: new Date(start.getTime() + 7 * DAY_MS) };
    }
    case "MONTHLY": {
      const start = startOfColomboMonth(now);
      // 32 days past the 1st always lands in the next month.
      return { start, end: startOfColomboMonth(new Date(start.getTime() + 32 * DAY_MS)) };
    }
  }
}
