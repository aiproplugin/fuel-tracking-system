import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatReportCell, rowMeterType } from "@/lib/reports/format-cell";
import type { ReportColumn, ReportRow } from "@/server/services/reports/report-types";

const NUMERIC_TYPES = new Set(["number", "liters", "meter", "efficiency"]);

/**
 * Generic report renderer. Reads `columns` + `rows` straight from the service
 * result and formats every cell with the shared {@link formatReportCell}, so
 * the on-screen numbers are the same the CSV writer produces. An optional
 * `getRowHref` turns the first column into a drill-down link.
 */
export function ReportTable({
  columns,
  rows,
  getRowHref,
  emptyLabel = "No rows for the selected filters.",
}: {
  columns: ReportColumn[];
  rows: ReportRow[];
  getRowHref?: (row: ReportRow) => string | null;
  emptyLabel?: string;
}) {
  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <tr>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={NUMERIC_TYPES.has(column.type) ? "text-right" : undefined}
              >
                {column.label}
              </TableHead>
            ))}
          </tr>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-muted">
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, rowIndex) => {
              const href = getRowHref?.(row) ?? null;
              return (
                <TableRow key={rowIndex}>
                  {columns.map((column, columnIndex) => {
                    const numeric = NUMERIC_TYPES.has(column.type);
                    const text = formatReportCell(
                      row[column.key] ?? null,
                      column.type,
                      rowMeterType(row),
                    );
                    const isLinkCell = columnIndex === 0 && href;
                    return (
                      <TableCell
                        key={column.key}
                        className={cn(
                          numeric && "text-right tabular-nums",
                          columnIndex === 0 && "font-semibold",
                        )}
                      >
                        {isLinkCell ? (
                          <Link href={href} className="text-primary hover:underline">
                            {text}
                          </Link>
                        ) : (
                          text
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
