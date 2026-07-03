import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatKilometers, formatLiters } from "@/lib/format";
import type { VehicleEfficiencyDetail } from "@/server/services/reports/report.service";

/**
 * D-level drill-down: one vehicle's fill-by-fill efficiency history. Server
 * component fed by the scoped service, so a supervisor only ever sees fills
 * from their own site's tanks.
 */
export function VehicleEfficiencyDetailView({ detail }: { detail: VehicleEfficiencyDetail }) {
  const { vehicle, totals, fills } = detail;
  const fuelVariant = vehicle.fuelType === "PETROL" ? "petrol" : "diesel";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/admin/reports" className="text-sm text-primary hover:underline">
          ← Back to reports
        </Link>
        <PageHeader
          eyebrow="Efficiency drill-down"
          title={vehicle.plateNumber}
          actions={<Badge variant={fuelVariant}>{vehicle.fuelType}</Badge>}
        />
        <p className="text-sm text-muted">
          {vehicle.vehicleType} · current odometer {formatKilometers(vehicle.currentOdometer)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Fills" value={totals.fills.toLocaleString("en-US")} />
        <KpiCard label="Total liters" value={formatLiters(totals.liters)} />
        <KpiCard label="Distance" value={formatKilometers(totals.km)} />
        <KpiCard
          label="Overall km/L"
          value={totals.kmPerLiter !== null ? totals.kmPerLiter.toFixed(2) : "—"}
        />
      </div>

      <TableContainer>
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Issued at</TableHead>
              <TableHead>Tank</TableHead>
              <TableHead className="text-right">Liters</TableHead>
              <TableHead className="text-right">Odometer</TableHead>
              <TableHead className="text-right">Distance</TableHead>
              <TableHead className="text-right">km/L</TableHead>
              <TableHead>Status</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {fills.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted">
                  No fills recorded for this vehicle in scope.
                </TableCell>
              </TableRow>
            ) : (
              fills.map((fill, index) => (
                <TableRow key={index}>
                  <TableCell className="text-muted">{formatDateTime(fill.issuedAt)}</TableCell>
                  <TableCell>{fill.tank}</TableCell>
                  <TableCell className="text-right tabular-nums">{fill.liters.toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKilometers(fill.odometer)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKilometers(fill.distanceKm)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fill.kmPerLiter !== null ? fill.kmPerLiter.toFixed(2) : "—"}
                  </TableCell>
                  <TableCell>
                    {fill.isAbnormal ? (
                      <Badge variant="warning">Abnormal</Badge>
                    ) : (
                      <Badge variant="success">Normal</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}
