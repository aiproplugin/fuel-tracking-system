import type { ReportKey } from "@/lib/schemas/reports";

/**
 * Shared report shapes. Rows carry PRIMITIVE values (numbers stay numbers) so
 * that the on-screen table, the CSV, and the XLSX all render the exact same
 * underlying figure — presentation-layer formatting never changes the number.
 */
export type ReportColumnType = "text" | "number" | "liters" | "km" | "kmpl" | "datetime";

export interface ReportColumn {
  key: string;
  label: string;
  type: ReportColumnType;
}

export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

export interface ReportSummaryItem {
  label: string;
  value: string;
}

export interface ReportRange {
  from: string | null;
  to: string | null;
}

export interface ReportResult {
  key: ReportKey;
  columns: ReportColumn[];
  rows: ReportRow[];
  summary: ReportSummaryItem[];
  /** True total matching the scope+filters, even when `rows` is display-capped. */
  totalRows: number;
  truncated: boolean;
  meta: {
    title: string;
    generatedAt: string;
    scopeNote: string;
    range: ReportRange;
  };
}

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  siteId?: string;
  vehicleId?: string;
  tankId?: string;
}

export interface ReportRunOptions {
  /** Max rows returned in `rows` (summary/totalRows stay full-set correct). */
  rowLimit: number;
}
