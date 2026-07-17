import ExcelJS from "exceljs";
import { METER_CONFIG, type MeterTypeName } from "@/lib/meter";
import { formatReportCell, rowMeterType } from "@/lib/reports/format-cell";
import type { ReportColumnType, ReportResult } from "@/server/services/reports/report-types";

/**
 * Formatted .xlsx for the management summaries. Numeric cells are written as
 * REAL numbers with a matching number format (so totals stay computable in
 * Excel and identical to the on-screen figure); text/datetime cells use the
 * same formatter as the screen and CSV. Meter/efficiency formats carry the
 * ROW's unit (km vs hrs vs kWh) so mixed-fleet sheets stay unambiguous.
 */

const NUM_FMT: Partial<Record<ReportColumnType, string>> = {
  liters: '#,##0.00 "L"',
  number: "#,##0",
};

/** Number format for a cell, resolving meter/efficiency units per row. */
function cellNumFmt(
  type: ReportColumnType,
  meterType: MeterTypeName | undefined,
): string | undefined {
  if (type === "meter") {
    return meterType ? `#,##0" ${METER_CONFIG[meterType].unit}"` : "#,##0";
  }
  if (type === "efficiency") {
    return meterType ? `0.00" ${METER_CONFIG[meterType].efficiencyUnit}"` : "0.00";
  }
  return NUM_FMT[type];
}

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0F172A" },
};

export async function reportToXlsx(result: ReportResult): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Fuel Tracking System";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(result.meta.title.slice(0, 31));

  const columnCount = result.columns.length;

  // Title + context banner.
  sheet.mergeCells(1, 1, 1, columnCount);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = result.meta.title;
  titleCell.font = { bold: true, size: 14, color: { argb: "FF0F172A" } };

  sheet.mergeCells(2, 1, 2, columnCount);
  const rangeText =
    result.meta.range.from || result.meta.range.to
      ? `${result.meta.range.from ?? "…"} to ${result.meta.range.to ?? "…"}`
      : "All dates";
  sheet.getCell(2, 1).value = `${result.meta.scopeNote} · ${rangeText} · Generated ${new Date(
    result.meta.generatedAt,
  ).toISOString()}`;
  sheet.getCell(2, 1).font = { color: { argb: "FF475569" }, size: 10 };

  // Header row.
  const headerRowIndex = 4;
  const headerRow = sheet.getRow(headerRowIndex);
  result.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.label;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle" };
  });
  headerRow.commit();
  sheet.views = [{ state: "frozen", ySplit: headerRowIndex }];

  // Data rows.
  result.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(headerRowIndex + 1 + rowIndex);
    const meterType = rowMeterType(row);
    result.columns.forEach((column, columnIndex) => {
      const cell = excelRow.getCell(columnIndex + 1);
      const raw = row[column.key] ?? null;
      const numFmt = cellNumFmt(column.type, meterType);
      if (numFmt && typeof raw === "number") {
        cell.value = raw;
        cell.numFmt = numFmt;
      } else {
        cell.value = formatReportCell(raw, column.type, meterType);
      }
    });
    excelRow.commit();
  });

  // Reasonable column widths.
  result.columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = Math.min(Math.max(column.label.length + 4, 12), 32);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
