import { describe, expect, it } from "vitest";
import {
  currentColomboWindow,
  startOfColomboDay,
  startOfColomboMonth,
  startOfColomboWeek,
} from "@/lib/format";

/**
 * Asia/Colombo is UTC+5:30 with no DST. 2026-07-13 is a Monday.
 * Reference instant: 2026-07-15T10:00:00Z = Wednesday 15:30 in Colombo.
 */
const WED = new Date("2026-07-15T10:00:00.000Z");

describe("Colombo period-window primitives", () => {
  it("startOfColomboDay returns the UTC instant of Colombo midnight", () => {
    expect(startOfColomboDay(WED).toISOString()).toBe("2026-07-14T18:30:00.000Z");
  });

  it("handles the UTC/Colombo date mismatch (UTC evening = Colombo next day)", () => {
    // Mon 20:00 UTC is already Tue 01:30 in Colombo.
    const utcMondayEvening = new Date("2026-07-13T20:00:00.000Z");
    expect(startOfColomboDay(utcMondayEvening).toISOString()).toBe("2026-07-13T18:30:00.000Z");
    // The Colombo Tuesday belongs to the week starting Colombo Monday.
    expect(startOfColomboWeek(utcMondayEvening, "MONDAY").toISOString()).toBe(
      "2026-07-12T18:30:00.000Z",
    );
  });

  it("startOfColomboWeek honours the configured week-start day", () => {
    expect(startOfColomboWeek(WED, "MONDAY").toISOString()).toBe("2026-07-12T18:30:00.000Z");
    expect(startOfColomboWeek(WED, "SUNDAY").toISOString()).toBe("2026-07-11T18:30:00.000Z");
    expect(startOfColomboWeek(WED, "SATURDAY").toISOString()).toBe("2026-07-10T18:30:00.000Z");
    // On the week-start day itself the window starts that same day.
    const monday = new Date("2026-07-13T04:00:00.000Z"); // Colombo Mon 09:30
    expect(startOfColomboWeek(monday, "MONDAY").toISOString()).toBe("2026-07-12T18:30:00.000Z");
  });

  it("startOfColomboMonth returns Colombo midnight on the 1st", () => {
    expect(startOfColomboMonth(WED).toISOString()).toBe("2026-06-30T18:30:00.000Z");
  });
});

describe("currentColomboWindow — each period measures its OWN window", () => {
  it("DAILY = since Colombo midnight, 24h wide", () => {
    const window = currentColomboWindow("DAILY", WED, "MONDAY");
    expect(window.start.toISOString()).toBe("2026-07-14T18:30:00.000Z");
    expect(window.end.toISOString()).toBe("2026-07-15T18:30:00.000Z");
  });

  it("WEEKLY = since the configured week start, 7 days wide", () => {
    const window = currentColomboWindow("WEEKLY", WED, "MONDAY");
    expect(window.start.toISOString()).toBe("2026-07-12T18:30:00.000Z");
    expect(window.end.toISOString()).toBe("2026-07-19T18:30:00.000Z");
  });

  it("MONTHLY = since the 1st, ending on the 1st of the next month", () => {
    const window = currentColomboWindow("MONTHLY", WED, "MONDAY");
    expect(window.start.toISOString()).toBe("2026-06-30T18:30:00.000Z");
    expect(window.end.toISOString()).toBe("2026-07-31T18:30:00.000Z");
  });

  it("mixed periods: a daily truck, a weekly car, and a monthly default each get different windows from the same instant", () => {
    const daily = currentColomboWindow("DAILY", WED, "MONDAY");
    const weekly = currentColomboWindow("WEEKLY", WED, "MONDAY");
    const monthly = currentColomboWindow("MONTHLY", WED, "MONDAY");
    const starts = new Set([
      daily.start.toISOString(),
      weekly.start.toISOString(),
      monthly.start.toISOString(),
    ]);
    expect(starts.size).toBe(3);
    // All three windows contain "now".
    for (const window of [daily, weekly, monthly]) {
      expect(window.start.getTime()).toBeLessThanOrEqual(WED.getTime());
      expect(window.end.getTime()).toBeGreaterThan(WED.getTime());
    }
  });

  it("December rolls the monthly window into January", () => {
    const december = new Date("2026-12-20T10:00:00.000Z");
    const window = currentColomboWindow("MONTHLY", december, "MONDAY");
    expect(window.start.toISOString()).toBe("2026-11-30T18:30:00.000Z");
    expect(window.end.toISOString()).toBe("2026-12-31T18:30:00.000Z");
  });
});
