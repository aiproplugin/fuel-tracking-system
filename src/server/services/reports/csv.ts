import { formatReportCell } from "@/lib/reports/format-cell";
import type { ReportResult } from "@/server/services/reports/report-types";

/**
 * RFC-4180 CSV serializer with spreadsheet formula-injection defence. Cells are
 * rendered with the SAME {@link formatReportCell} the on-screen table uses, so
 * the CSV and the screen show identical text. A UTF-8 BOM is prepended so Excel
 * opens it as UTF-8.
 */

const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@"]);

/** Escape a single field: quote when needed, and neutralise formula triggers. */
function escapeField(raw: string): string {
  // Leading chars Excel/Sheets would treat as a formula — prefix with a quote.
  let value = raw;
  if (value.length > 0 && (FORMULA_TRIGGERS.has(value[0]!) || value[0] === "\t" || value[0] === "\r")) {
    value = `'${value}`;
  }
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function reportToCsv(result: ReportResult): string {
  const header = result.columns.map((column) => escapeField(column.label)).join(",");
  const lines = result.rows.map((row) =>
    result.columns.map((column) => escapeField(formatReportCell(row[column.key] ?? null, column.type))).join(","),
  );
  const body = [header, ...lines].join("\r\n");
  return `﻿${body}\r\n`;
}
