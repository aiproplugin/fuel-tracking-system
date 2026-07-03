import { formatDateTime, formatKilometers, formatLiters } from "@/lib/format";
import type { ReportCell, ReportColumnType } from "@/server/services/reports/report-types";

/**
 * Single source of truth for turning a report cell into display text. Used by
 * the on-screen table AND the CSV writer so the two can never disagree. (The
 * XLSX writer keeps numeric cells as real numbers with a matching number
 * format — the underlying value is identical, Excel just formats it.)
 */
export function formatReportCell(value: ReportCell, type: ReportColumnType): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  switch (type) {
    case "liters":
      return formatLiters(Number(value));
    case "km":
      return formatKilometers(Number(value));
    case "kmpl":
      return Number(value).toFixed(2);
    case "number":
      return Number(value).toLocaleString("en-US");
    case "datetime":
      return formatDateTime(String(value));
    case "text":
    default:
      return String(value);
  }
}
