import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTime } from "@/lib/format";
import type { RecentTransaction } from "@/server/services/dashboard.service";

/**
 * D1 "Recent transactions" — latest ledger-backed activity across issues,
 * deliveries, and adjustments. One row per stock movement; liters are the
 * signed movement quantity so deliveries read positive and issues negative.
 */
const STATUS_CLASS: Record<RecentTransaction["status"], string> = {
  ISSUED: "text-success",
  FLAGGED: "text-warning",
  DELIVERY: "text-info",
  ADJUSTMENT: "text-warning",
};

const STATUS_LABEL: Record<RecentTransaction["status"], string> = {
  ISSUED: "Issued",
  FLAGGED: "Flagged",
  DELIVERY: "Delivery",
  ADJUSTMENT: "Adjustment",
};

export function RecentTransactions({ rows }: { rows: RecentTransaction[] }) {
  return (
    <div className="rounded-[28px] border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <p className="font-bold">Recent transactions</p>
        <span className="text-sm text-muted">Latest ledger-backed activity</span>
      </div>

      <div className="mt-5">
        <TableContainer>
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Time</TableHead>
                <TableHead>Vehicle / Source</TableHead>
                <TableHead>Tank</TableHead>
                <TableHead>Liters</TableHead>
                <TableHead>Status</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted">
                    No ledger activity yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted">{formatTime(row.occurredAt)}</TableCell>
                    <TableCell className="font-semibold">{row.vehicleLabel ?? "—"}</TableCell>
                    <TableCell>{row.tankName}</TableCell>
                    <TableCell className="font-semibold">
                      {row.liters > 0 ? "+" : ""}
                      {row.liters.toFixed(1)}
                    </TableCell>
                    <TableCell className={STATUS_CLASS[row.status]}>
                      {STATUS_LABEL[row.status]}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
    </div>
  );
}
