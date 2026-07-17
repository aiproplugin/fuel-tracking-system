import { formatDateTime, formatLiters } from "@/lib/format";
import { METER_CONFIG, formatEfficiencyFull, formatMeter, type MeterTypeName } from "@/lib/meter";
import type {
  ReportCell,
  ReportColumnType,
  ReportRow,
} from "@/server/services/reports/report-types";

/**
 * Single source of truth for turning a report cell into display text. Used by
 * the on-screen table AND the CSV writer so the two can never disagree. (The
 * XLSX writer keeps numeric cells as real numbers with a matching number
 * format — the underlying value is identical, Excel just formats it.)
 *
 * "meter"/"efficiency" cells take their unit from the row's meter type —
 * callers read it with {@link rowMeterType} and pass it through, so every row
 * in a mixed-fleet report renders its own unit (km vs hrs vs kWh).
 */
export function formatReportCell(
  value: ReportCell,
  type: ReportColumnType,
  meterType?: MeterTypeName,
): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  switch (type) {
    case "liters":
      return formatLiters(Number(value));
    case "meter":
      return meterType
        ? formatMeter(Number(value), meterType)
        : Number(value).toLocaleString("en-US");
    case "efficiency":
      return meterType ? formatEfficiencyFull(Number(value), meterType) : Number(value).toFixed(2);
    case "number":
      return Number(value).toLocaleString("en-US");
    case "datetime":
      return formatDateTime(String(value));
    case "text":
    default:
      return String(value);
  }
}

/** The reserved per-row meter-type carrier (see report-types.ts). */
export function rowMeterType(row: ReportRow): MeterTypeName | undefined {
  const value = row["_meterType"];
  return typeof value === "string" && value in METER_CONFIG ? (value as MeterTypeName) : undefined;
}
