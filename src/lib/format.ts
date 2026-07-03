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

/** "124,880 km" */
export function formatKilometers(km: number): string {
  return `${km.toLocaleString("en-US")} km`;
}

const COLOMBO_OFFSET_MS = 5.5 * 3_600_000;

/**
 * UTC instant of midnight in Asia/Colombo for the day containing `now`.
 * Storage stays UTC; "today" on operator screens means the Colombo day.
 */
export function startOfColomboDay(now: Date): Date {
  const shifted = new Date(now.getTime() + COLOMBO_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - COLOMBO_OFFSET_MS);
}
