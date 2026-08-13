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
import { formatDateTime, formatLiters } from "@/lib/format";
import { FUEL_CONFIG, fuelLabel } from "@/lib/fuel";
import { METER_CONFIG, formatEfficiencyFull, formatMeter } from "@/lib/meter";
import type { VehicleEfficiencyDetail } from "@/server/services/reports/report.service";

/**
 * D-level drill-down: one vehicle's fill-by-fill efficiency history. Server
 * component fed by the scoped service, so a supervisor only ever sees fills
 * from their own site's tanks. Units follow the vehicle's meter type
 * (km / hrs / kWh) — a single vehicle has exactly one.
 */
export function VehicleEfficiencyDetailView({ detail }: { detail: VehicleEfficiencyDetail }) {
  const { vehicle, totals, fills } = detail;
  const fuelVariant = FUEL_CONFIG[vehicle.fuelType].badgeVariant;
  const meter = METER_CONFIG[vehicle.meterType];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/admin/reports" className="text-sm text-primary hover:underline">
          ← Back to reports
        </Link>
        <PageHeader
          eyebrow="Efficiency drill-down"
          title={vehicle.plateNumber}
          actions={<Badge variant={fuelVariant}>{fuelLabel(vehicle.fuelType)}</Badge>}
        />
        <p className="text-sm text-muted">
          {vehicle.vehicleType} · current {meter.meterLabel.toLowerCase()}{" "}
          {formatMeter(vehicle.currentMeter, vehicle.meterType)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Fills" value={totals.fills.toLocaleString("en-US")} />
        <KpiCard label="Total liters" value={formatLiters(totals.liters)} />
        <KpiCard
          label={meter.deltaLabel}
          value={formatMeter(totals.meterDelta, vehicle.meterType)}
        />
        <KpiCard
          label={`Overall ${meter.efficiencyUnit}`}
          value={totals.efficiency !== null ? totals.efficiency.toFixed(2) : "—"}
        />
      </div>

      <TableContainer>
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Issued at</TableHead>
              <TableHead>Tank</TableHead>
              <TableHead className="text-right">Liters</TableHead>
              <TableHead className="text-right">{meter.meterLabel}</TableHead>
              <TableHead className="text-right">{meter.deltaLabel}</TableHead>
              <TableHead className="text-right">Efficiency</TableHead>
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
                  <TableCell className="text-right tabular-nums">
                    {fill.liters.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMeter(fill.meterReading, vehicle.meterType)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMeter(fill.meterDelta, vehicle.meterType)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fill.efficiency !== null
                      ? formatEfficiencyFull(fill.efficiency, vehicle.meterType)
                      : "—"}
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
