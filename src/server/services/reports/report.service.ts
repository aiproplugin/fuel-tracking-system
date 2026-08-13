import { Prisma, type MeterType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { env } from "@/lib/env";
import { formatLiters, startOfColomboDay } from "@/lib/format";
import { type FuelTypeName } from "@/lib/fuel";
import { METER_CONFIG, formatEfficiency, formatMeter } from "@/lib/meter";
import type { ReportKey } from "@/lib/schemas/reports";
import { db } from "@/server/db";
import { effectiveSiteId, type Actor } from "@/server/services/actor";
import { REPORT_DESCRIPTORS } from "@/server/services/reports/report-registry";
import type {
  ReportFilters,
  ReportResult,
  ReportRunOptions,
} from "@/server/services/reports/report-types";

/**
 * REPORTS — ledger-derived read models. Everything here is scoped through the
 * same {@link effectiveSiteId} rule the dashboards use (supervisors are pinned
 * to their own site; a supplied `siteId` is ignored for them), and reads from
 * `FuelTransaction`/`StockMovement`/`Delivery`/`Tank` — the same sources as the
 * dashboards — so an exported figure can never disagree with the on-screen one.
 *
 * `runReport` is the single dispatch point used by BOTH the on-screen tRPC
 * query and the export route handler, guaranteeing screen == CSV == XLSX.
 */

const DAY_MS = 24 * 3_600_000;
/** Hard ceiling for reports aggregated in-process, to bound memory. */
const MAX_SCAN = 100_000;

const monthKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Colombo",
  year: "numeric",
  month: "2-digit",
});
const monthLabelFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  year: "numeric",
  month: "short",
});

/** Colombo midnight at the START of the given yyyy-mm-dd day (as a UTC instant). */
function colomboStart(isoDate: string): Date {
  // Noon UTC is always inside the same Colombo calendar day, so the day never shifts.
  return startOfColomboDay(new Date(`${isoDate}T12:00:00.000Z`));
}

/** Inclusive Colombo date-range → a Prisma { gte, lt } fragment (or {} if unset). */
function dateRangeWhere(from?: string, to?: string): { gte?: Date; lt?: Date } {
  const where: { gte?: Date; lt?: Date } = {};
  if (from) where.gte = colomboStart(from);
  if (to) where.lt = new Date(colomboStart(to).getTime() + DAY_MS);
  return where;
}

interface Scope {
  siteId: string | undefined;
  tankWhere: { siteId?: string };
  relWhere: { tank?: { siteId: string } };
  note: string;
}

function resolveScope(actor: Actor, filters: ReportFilters): Scope {
  const siteId = effectiveSiteId(actor, filters.siteId);
  const note =
    actor.role === "SUPERVISOR"
      ? "Your site only"
      : siteId
        ? "Filtered to selected site"
        : "All sites";
  return {
    siteId,
    tankWhere: siteId ? { siteId } : {},
    relWhere: siteId ? { tank: { siteId } } : {},
    note,
  };
}

/** Per-fill meter delta in the vehicle's own unit (km / hrs / kWh). */
function meterDelta(reading: number, previousReading: number): number {
  return Math.max(0, reading - previousReading);
}

function dec(value: Prisma.Decimal | null | undefined): number {
  return value ? value.toNumber() : 0;
}

type RawResult = Pick<ReportResult, "columns" | "rows" | "summary" | "totalRows" | "truncated">;

// ---------------------------------------------------------------------------
// Transaction-level reports
// ---------------------------------------------------------------------------

async function runVehicleUsage(
  actor: Actor,
  filters: ReportFilters,
  options: ReportRunOptions,
): Promise<RawResult> {
  const scope = resolveScope(actor, filters);
  const where: Prisma.FuelTransactionWhereInput = {
    ...scope.relWhere,
    ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
    ...(filters.tankId ? { tankId: filters.tankId } : {}),
    issuedAt: dateRangeWhere(filters.dateFrom, filters.dateTo),
  };

  const [aggregate, rows] = await Promise.all([
    db.fuelTransaction.aggregate({ where, _sum: { liters: true }, _count: { _all: true } }),
    db.fuelTransaction.findMany({
      where,
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      take: options.rowLimit,
      include: {
        vehicle: {
          select: { plateNumber: true, vehicleType: { select: { meterType: true } } },
        },
        tank: { select: { name: true } },
        operator: { select: { displayName: true } },
      },
    }),
  ]);

  const totalRows = aggregate._count._all;
  return {
    columns: [
      { key: "issuedAt", label: "Issued at", type: "datetime" },
      { key: "vehicle", label: "Vehicle", type: "text" },
      { key: "tank", label: "Tank", type: "text" },
      { key: "operator", label: "Operator", type: "text" },
      { key: "liters", label: "Liters", type: "liters" },
      { key: "meterReading", label: "Meter", type: "meter" },
      { key: "efficiency", label: "Efficiency", type: "efficiency" },
      { key: "status", label: "Status", type: "text" },
    ],
    rows: rows.map((row) => ({
      _meterType: row.vehicle.vehicleType.meterType,
      issuedAt: row.issuedAt.toISOString(),
      vehicle: row.vehicle.plateNumber,
      tank: row.tank.name,
      operator: row.operator.displayName,
      liters: dec(row.liters),
      meterReading: row.meterReading,
      efficiency: row.efficiency ? row.efficiency.toNumber() : null,
      status: row.isAbnormal ? "Abnormal" : row.meterOverride ? "Override" : "Issued",
    })),
    summary: [
      { label: "Transactions", value: totalRows.toLocaleString("en-US") },
      { label: "Total liters", value: formatLiters(dec(aggregate._sum.liters)) },
    ],
    totalRows,
    truncated: totalRows > rows.length,
  };
}

async function runAbnormal(
  actor: Actor,
  filters: ReportFilters,
  options: ReportRunOptions,
): Promise<RawResult> {
  const scope = resolveScope(actor, filters);
  const where: Prisma.FuelTransactionWhereInput = {
    ...scope.relWhere,
    isAbnormal: true,
    ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
    issuedAt: dateRangeWhere(filters.dateFrom, filters.dateTo),
  };

  const [totalRows, rows] = await Promise.all([
    db.fuelTransaction.count({ where }),
    db.fuelTransaction.findMany({
      where,
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      take: options.rowLimit,
      include: {
        vehicle: {
          select: {
            plateNumber: true,
            vehicleType: {
              select: { name: true, meterType: true, minEfficiency: true, maxEfficiency: true },
            },
          },
        },
        tank: { select: { name: true } },
      },
    }),
  ]);

  return {
    columns: [
      { key: "issuedAt", label: "Issued at", type: "datetime" },
      { key: "vehicle", label: "Vehicle", type: "text" },
      { key: "vehicleType", label: "Type", type: "text" },
      { key: "tank", label: "Tank", type: "text" },
      { key: "liters", label: "Liters", type: "liters" },
      { key: "efficiency", label: "Efficiency", type: "efficiency" },
      { key: "band", label: "Expected band", type: "text" },
    ],
    rows: rows.map((row) => ({
      _meterType: row.vehicle.vehicleType.meterType,
      issuedAt: row.issuedAt.toISOString(),
      vehicle: row.vehicle.plateNumber,
      vehicleType: row.vehicle.vehicleType.name,
      tank: row.tank.name,
      liters: dec(row.liters),
      efficiency: row.efficiency ? row.efficiency.toNumber() : null,
      band: `${dec(row.vehicle.vehicleType.minEfficiency).toFixed(1)}–${dec(row.vehicle.vehicleType.maxEfficiency).toFixed(1)} ${METER_CONFIG[row.vehicle.vehicleType.meterType].efficiencyUnit}`,
    })),
    summary: [{ label: "Flagged transactions", value: totalRows.toLocaleString("en-US") }],
    totalRows,
    truncated: totalRows > rows.length,
  };
}

async function runTankLedger(
  actor: Actor,
  filters: ReportFilters,
  options: ReportRunOptions,
): Promise<RawResult> {
  const scope = resolveScope(actor, filters);
  const where: Prisma.StockMovementWhereInput = {
    ...scope.relWhere,
    ...(filters.tankId ? { tankId: filters.tankId } : {}),
    createdAt: dateRangeWhere(filters.dateFrom, filters.dateTo),
  };

  const [totalRows, rows] = await Promise.all([
    db.stockMovement.count({ where }),
    db.stockMovement.findMany({
      where,
      orderBy: { id: "desc" },
      take: options.rowLimit,
      include: {
        tank: { select: { name: true } },
        fuelTransaction: { select: { vehicle: { select: { plateNumber: true } } } },
        delivery: { select: { supplierName: true, referenceNo: true } },
        adjustment: { select: { reason: true } },
      },
    }),
  ]);

  return {
    columns: [
      { key: "time", label: "Time", type: "datetime" },
      { key: "tank", label: "Tank", type: "text" },
      { key: "type", label: "Type", type: "text" },
      { key: "quantity", label: "Change", type: "liters" },
      { key: "balanceAfter", label: "Balance after", type: "liters" },
      { key: "reference", label: "Reference", type: "text" },
    ],
    rows: rows.map((row) => ({
      time: row.createdAt.toISOString(),
      tank: row.tank.name,
      type: row.type,
      quantity: dec(row.quantity),
      balanceAfter: dec(row.balanceAfter),
      reference:
        row.fuelTransaction?.vehicle.plateNumber ??
        (row.delivery
          ? (row.delivery.supplierName ?? row.delivery.referenceNo ?? "Delivery")
          : null) ??
        row.adjustment?.reason ??
        "",
    })),
    summary: [{ label: "Movements", value: totalRows.toLocaleString("en-US") }],
    totalRows,
    truncated: totalRows > rows.length,
  };
}

async function runDeliveryHistory(
  actor: Actor,
  filters: ReportFilters,
  options: ReportRunOptions,
): Promise<RawResult> {
  const scope = resolveScope(actor, filters);
  const where: Prisma.DeliveryWhereInput = {
    ...scope.relWhere,
    ...(filters.tankId ? { tankId: filters.tankId } : {}),
    deliveredAt: dateRangeWhere(filters.dateFrom, filters.dateTo),
  };

  const [aggregate, rows] = await Promise.all([
    db.delivery.aggregate({ where, _sum: { liters: true }, _count: { _all: true } }),
    db.delivery.findMany({
      where,
      orderBy: [{ deliveredAt: "desc" }, { createdAt: "desc" }],
      take: options.rowLimit,
      include: {
        tank: { select: { name: true } },
        receivedBy: { select: { displayName: true } },
      },
    }),
  ]);

  const totalRows = aggregate._count._all;
  return {
    columns: [
      { key: "deliveredAt", label: "Delivered at", type: "datetime" },
      { key: "tank", label: "Tank", type: "text" },
      { key: "liters", label: "Liters", type: "liters" },
      { key: "supplier", label: "Supplier", type: "text" },
      { key: "referenceNo", label: "Reference", type: "text" },
      { key: "receivedBy", label: "Received by", type: "text" },
    ],
    rows: rows.map((row) => ({
      deliveredAt: row.deliveredAt.toISOString(),
      tank: row.tank.name,
      liters: dec(row.liters),
      supplier: row.supplierName ?? "",
      referenceNo: row.referenceNo ?? "",
      receivedBy: row.receivedBy.displayName,
    })),
    summary: [
      { label: "Deliveries", value: totalRows.toLocaleString("en-US") },
      { label: "Total liters", value: formatLiters(dec(aggregate._sum.liters)) },
    ],
    totalRows,
    truncated: totalRows > rows.length,
  };
}

// ---------------------------------------------------------------------------
// Snapshot report
// ---------------------------------------------------------------------------

async function runLowStock(actor: Actor, filters: ReportFilters): Promise<RawResult> {
  const scope = resolveScope(actor, filters);
  const tanks = await db.tank.findMany({
    where: { ...scope.tankWhere, isActive: true },
    orderBy: { name: "asc" },
    include: { site: { select: { name: true } } },
  });
  const low = tanks.filter((tank) => tank.currentStock.lessThan(tank.lowStockThreshold));

  return {
    columns: [
      { key: "tank", label: "Tank", type: "text" },
      { key: "site", label: "Site", type: "text" },
      { key: "fuelType", label: "Fuel", type: "text" },
      { key: "currentStock", label: "Current stock", type: "liters" },
      { key: "threshold", label: "Threshold", type: "liters" },
      { key: "capacity", label: "Capacity", type: "liters" },
      { key: "pctFull", label: "% full", type: "text" },
    ],
    rows: low.map((tank) => {
      const capacity = dec(tank.capacityLiters);
      const current = dec(tank.currentStock);
      const pct = capacity > 0 ? Math.round((current / capacity) * 100) : 0;
      return {
        tank: tank.name,
        site: tank.site.name,
        fuelType: tank.fuelType,
        currentStock: current,
        threshold: dec(tank.lowStockThreshold),
        capacity,
        pctFull: `${pct}%`,
      };
    }),
    summary: [{ label: "Low-stock tanks", value: low.length.toLocaleString("en-US") }],
    totalRows: low.length,
    truncated: false,
  };
}

// ---------------------------------------------------------------------------
// Aggregated management reports (in-process grouping)
// ---------------------------------------------------------------------------

interface FillRow {
  vehicleId: string;
  plateNumber: string;
  vehicleTypeName: string;
  meterType: MeterType;
  issuedAt: Date;
  liters: number;
  meterReading: number;
  previousMeterReading: number;
  efficiency: number | null;
  isAbnormal: boolean;
}

async function scanFills(
  actor: Actor,
  filters: ReportFilters,
): Promise<{ fills: FillRow[]; truncated: boolean }> {
  const scope = resolveScope(actor, filters);
  const rows = await db.fuelTransaction.findMany({
    where: {
      ...scope.relWhere,
      ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
      issuedAt: dateRangeWhere(filters.dateFrom, filters.dateTo),
    },
    orderBy: [{ issuedAt: "asc" }, { createdAt: "asc" }],
    take: MAX_SCAN + 1,
    include: {
      vehicle: {
        select: { plateNumber: true, vehicleType: { select: { name: true, meterType: true } } },
      },
    },
  });
  const truncated = rows.length > MAX_SCAN;
  const fills = (truncated ? rows.slice(0, MAX_SCAN) : rows).map((row) => ({
    vehicleId: row.vehicleId,
    plateNumber: row.vehicle.plateNumber,
    vehicleTypeName: row.vehicle.vehicleType.name,
    meterType: row.vehicle.vehicleType.meterType,
    issuedAt: row.issuedAt,
    liters: dec(row.liters),
    meterReading: row.meterReading,
    previousMeterReading: row.previousMeterReading,
    efficiency: row.efficiency ? row.efficiency.toNumber() : null,
    isAbnormal: row.isAbnormal,
  }));
  return { fills, truncated };
}

/**
 * Per-meter-type delta totals for report summaries. Deltas in different units
 * (km vs hrs vs kWh) are NEVER summed together — one summary item per meter
 * type present. Litres, by contrast, may always total across the whole set.
 */
function meterDeltaSummaryItems(
  deltasByType: ReadonlyMap<MeterType, number>,
): { label: string; value: string }[] {
  return [...deltasByType.entries()].map(([meterType, delta]) => ({
    label: `Total ${METER_CONFIG[meterType].deltaLabel.toLowerCase()}`,
    value: formatMeter(delta, meterType),
  }));
}

async function runVehicleMonthly(
  actor: Actor,
  filters: ReportFilters,
  options: ReportRunOptions,
): Promise<RawResult> {
  const { fills, truncated } = await scanFills(actor, filters);

  const groups = new Map<
    string,
    {
      monthKey: string;
      month: string;
      plate: string;
      type: string;
      meterType: MeterType;
      fills: number;
      liters: number;
      delta: number;
    }
  >();
  for (const fill of fills) {
    const monthKey = monthKeyFormatter.format(fill.issuedAt);
    const key = `${fill.vehicleId}|${monthKey}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        monthKey,
        month: monthLabelFormatter.format(fill.issuedAt),
        plate: fill.plateNumber,
        type: fill.vehicleTypeName,
        meterType: fill.meterType,
        fills: 0,
        liters: 0,
        delta: 0,
      };
      groups.set(key, group);
    }
    group.fills += 1;
    group.liters += fill.liters;
    group.delta += meterDelta(fill.meterReading, fill.previousMeterReading);
  }

  const ordered = [...groups.values()].sort(
    (a, b) => a.plate.localeCompare(b.plate) || a.monthKey.localeCompare(b.monthKey),
  );
  const totalRows = ordered.length;
  const totalLiters = ordered.reduce((sum, group) => sum + group.liters, 0);
  // Litres total across the whole fleet; meter deltas only within a meter type.
  const deltasByType = new Map<MeterType, number>();
  for (const group of ordered) {
    deltasByType.set(group.meterType, (deltasByType.get(group.meterType) ?? 0) + group.delta);
  }

  return {
    columns: [
      { key: "month", label: "Month", type: "text" },
      { key: "vehicle", label: "Vehicle", type: "text" },
      { key: "vehicleType", label: "Type", type: "text" },
      { key: "fills", label: "Fills", type: "number" },
      { key: "liters", label: "Liters", type: "liters" },
      { key: "meterDelta", label: "Meter delta", type: "meter" },
      { key: "efficiency", label: "Efficiency", type: "efficiency" },
    ],
    rows: ordered.slice(0, options.rowLimit).map((group) => ({
      _meterType: group.meterType,
      month: group.month,
      vehicle: group.plate,
      vehicleType: group.type,
      fills: group.fills,
      liters: group.liters,
      meterDelta: group.delta,
      efficiency: group.liters > 0 ? Math.round((group.delta / group.liters) * 100) / 100 : null,
    })),
    summary: [
      { label: "Rows", value: totalRows.toLocaleString("en-US") },
      { label: "Total liters", value: formatLiters(totalLiters) },
      ...meterDeltaSummaryItems(deltasByType),
    ],
    totalRows,
    truncated: truncated || totalRows > options.rowLimit,
  };
}

async function runVehicleEfficiency(
  actor: Actor,
  filters: ReportFilters,
  options: ReportRunOptions,
): Promise<RawResult> {
  const { fills, truncated } = await scanFills(actor, filters);

  const groups = new Map<
    string,
    {
      vehicleId: string;
      plate: string;
      type: string;
      meterType: MeterType;
      fills: number;
      liters: number;
      delta: number;
      abnormal: number;
    }
  >();
  for (const fill of fills) {
    let group = groups.get(fill.vehicleId);
    if (!group) {
      group = {
        vehicleId: fill.vehicleId,
        plate: fill.plateNumber,
        type: fill.vehicleTypeName,
        meterType: fill.meterType,
        fills: 0,
        liters: 0,
        delta: 0,
        abnormal: 0,
      };
      groups.set(fill.vehicleId, group);
    }
    group.fills += 1;
    group.liters += fill.liters;
    group.delta += meterDelta(fill.meterReading, fill.previousMeterReading);
    if (fill.isAbnormal) group.abnormal += 1;
  }

  const rows = [...groups.values()].map((group) => ({
    vehicleId: group.vehicleId,
    plate: group.plate,
    type: group.type,
    meterType: group.meterType,
    fills: group.fills,
    liters: group.liters,
    delta: group.delta,
    efficiency: group.liters > 0 ? Math.round((group.delta / group.liters) * 100) / 100 : null,
    abnormal: group.abnormal,
  }));
  // Efficiency values in different units are incomparable, so the ranking is
  // grouped by meter type first, then worst efficiency first within the group;
  // vehicles without a computable efficiency sort last in their group.
  rows.sort(
    (a, b) =>
      a.meterType.localeCompare(b.meterType) ||
      (a.efficiency ?? Infinity) - (b.efficiency ?? Infinity),
  );

  // Fleet efficiency is only meaningful WITHIN one meter type — one summary
  // tile per type present, each derived from that type's own litres + deltas.
  const fleetByType = new Map<MeterType, { liters: number; delta: number }>();
  for (const row of rows) {
    const totals = fleetByType.get(row.meterType) ?? { liters: 0, delta: 0 };
    totals.liters += row.liters;
    totals.delta += row.delta;
    fleetByType.set(row.meterType, totals);
  }
  const fleetSummary = [...fleetByType.entries()].map(([meterType, totals]) => ({
    label: `Fleet ${METER_CONFIG[meterType].efficiencyUnit}`,
    value: totals.liters > 0 ? formatEfficiency(totals.delta / totals.liters, meterType) : "—",
  }));

  return {
    columns: [
      { key: "plate", label: "Vehicle", type: "text" },
      { key: "type", label: "Type", type: "text" },
      { key: "fills", label: "Fills", type: "number" },
      { key: "liters", label: "Liters", type: "liters" },
      { key: "meterDelta", label: "Meter delta", type: "meter" },
      { key: "efficiency", label: "Efficiency", type: "efficiency" },
      { key: "abnormal", label: "Abnormal", type: "number" },
    ],
    rows: rows.slice(0, options.rowLimit).map((row) => ({
      // `_vehicleId` is carried for the drill-down link; it is not a column, so
      // CSV/XLSX never emit it.
      _vehicleId: row.vehicleId,
      _meterType: row.meterType,
      plate: row.plate,
      type: row.type,
      fills: row.fills,
      liters: row.liters,
      meterDelta: row.delta,
      efficiency: row.efficiency,
      abnormal: row.abnormal,
    })),
    summary: [{ label: "Vehicles", value: rows.length.toLocaleString("en-US") }, ...fleetSummary],
    totalRows: rows.length,
    truncated: truncated || rows.length > options.rowLimit,
  };
}

async function runDriverUsage(
  actor: Actor,
  filters: ReportFilters,
  options: ReportRunOptions,
): Promise<RawResult> {
  const scope = resolveScope(actor, filters);
  const grouped = await db.fuelTransaction.groupBy({
    by: ["driverId"],
    where: {
      ...scope.relWhere,
      driverId: { not: null },
      issuedAt: dateRangeWhere(filters.dateFrom, filters.dateTo),
    },
    _sum: { liters: true },
    _count: { _all: true },
  });

  const driverIds = grouped
    .map((group) => group.driverId)
    .filter((id): id is string => id !== null);
  const drivers = await db.driver.findMany({
    where: { id: { in: driverIds } },
    select: { id: true, name: true, employeeNo: true },
  });
  const nameById = new Map(drivers.map((driver) => [driver.id, driver]));

  const rows = grouped
    .map((group) => {
      const driver = group.driverId ? nameById.get(group.driverId) : undefined;
      return {
        driver: driver?.name ?? "Unknown",
        employeeNo: driver?.employeeNo ?? "",
        fills: group._count._all,
        liters: dec(group._sum.liters),
      };
    })
    .sort((a, b) => b.liters - a.liters);

  return {
    columns: [
      { key: "driver", label: "Driver", type: "text" },
      { key: "employeeNo", label: "Employee no.", type: "text" },
      { key: "fills", label: "Fills", type: "number" },
      { key: "liters", label: "Liters", type: "liters" },
    ],
    rows: rows.slice(0, options.rowLimit),
    summary: [
      { label: "Drivers", value: rows.length.toLocaleString("en-US") },
      {
        label: "Total liters",
        value: formatLiters(rows.reduce((sum, row) => sum + row.liters, 0)),
      },
    ],
    totalRows: rows.length,
    truncated: rows.length > options.rowLimit,
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Single dispatch point. Applies the driver-report feature gate, runs the
 * matching report, and wraps it with title/scope/range metadata. Used by both
 * the on-screen query and the export handler so all three renderings agree.
 */
export async function runReport(
  actor: Actor,
  key: ReportKey,
  filters: ReportFilters,
  options: ReportRunOptions,
): Promise<ReportResult> {
  const descriptor = REPORT_DESCRIPTORS[key];
  if (descriptor.requiresFlag && !env.FEATURE_DRIVER_REPORTS) {
    // Feature is hidden: behave as if the report does not exist.
    throw new TRPCError({ code: "NOT_FOUND", message: "Report not found." });
  }

  const scope = resolveScope(actor, filters);
  const effectiveFilters: ReportFilters = descriptor.timeFiltered
    ? filters
    : { ...filters, dateFrom: undefined, dateTo: undefined };

  let raw: RawResult;
  switch (key) {
    case "vehicle-usage":
      raw = await runVehicleUsage(actor, effectiveFilters, options);
      break;
    case "vehicle-monthly":
      raw = await runVehicleMonthly(actor, effectiveFilters, options);
      break;
    case "vehicle-efficiency":
      raw = await runVehicleEfficiency(actor, effectiveFilters, options);
      break;
    case "tank-ledger":
      raw = await runTankLedger(actor, effectiveFilters, options);
      break;
    case "delivery-history":
      raw = await runDeliveryHistory(actor, effectiveFilters, options);
      break;
    case "abnormal-consumption":
      raw = await runAbnormal(actor, effectiveFilters, options);
      break;
    case "low-stock":
      raw = await runLowStock(actor, effectiveFilters);
      break;
    case "driver-usage":
      raw = await runDriverUsage(actor, effectiveFilters, options);
      break;
  }

  return {
    key,
    ...raw,
    meta: {
      title: descriptor.title,
      generatedAt: new Date().toISOString(),
      scopeNote: scope.note,
      range: {
        from: descriptor.timeFiltered ? (effectiveFilters.dateFrom ?? null) : null,
        to: descriptor.timeFiltered ? (effectiveFilters.dateTo ?? null) : null,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Per-vehicle efficiency drill-down
// ---------------------------------------------------------------------------

export interface VehicleEfficiencyDetail {
  vehicle: {
    id: string;
    plateNumber: string;
    vehicleType: string;
    meterType: MeterType;
    fuelType: FuelTypeName;
    currentMeter: number;
  };
  totals: { fills: number; liters: number; meterDelta: number; efficiency: number | null };
  fills: {
    issuedAt: string;
    tank: string;
    liters: number;
    meterReading: number;
    meterDelta: number;
    efficiency: number | null;
    isAbnormal: boolean;
  }[];
}

/**
 * Fill-by-fill efficiency history for one vehicle (the D-level drill-down).
 * Scoped: a supervisor only sees fills issued from their own site's tanks, so
 * the drill-down can never leak cross-site activity. Returns null if the
 * vehicle does not exist (or is out of scope with no visible fills).
 */
export async function getVehicleEfficiencyDetail(
  actor: Actor,
  vehicleId: string,
  filters: { dateFrom?: string; dateTo?: string },
): Promise<VehicleEfficiencyDetail | null> {
  const scope = resolveScope(actor, filters);
  const vehicle = await db.vehicle.findUnique({
    where: { id: vehicleId },
    include: { vehicleType: { select: { name: true, meterType: true } } },
  });
  if (!vehicle) return null;

  const rows = await db.fuelTransaction.findMany({
    where: {
      vehicleId,
      ...scope.relWhere,
      issuedAt: dateRangeWhere(filters.dateFrom, filters.dateTo),
    },
    orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
    take: MAX_SCAN,
    include: { tank: { select: { name: true } } },
  });

  let totalLiters = 0;
  let totalDelta = 0;
  const fills = rows.map((row) => {
    const liters = dec(row.liters);
    const delta = meterDelta(row.meterReading, row.previousMeterReading);
    totalLiters += liters;
    totalDelta += delta;
    return {
      issuedAt: row.issuedAt.toISOString(),
      tank: row.tank.name,
      liters,
      meterReading: row.meterReading,
      meterDelta: delta,
      efficiency: row.efficiency ? row.efficiency.toNumber() : null,
      isAbnormal: row.isAbnormal,
    };
  });

  return {
    vehicle: {
      id: vehicle.id,
      plateNumber: vehicle.plateNumber,
      vehicleType: vehicle.vehicleType.name,
      meterType: vehicle.vehicleType.meterType,
      fuelType: vehicle.fuelType,
      currentMeter: vehicle.currentMeter,
    },
    totals: {
      fills: fills.length,
      liters: totalLiters,
      meterDelta: totalDelta,
      efficiency: totalLiters > 0 ? Math.round((totalDelta / totalLiters) * 100) / 100 : null,
    },
    fills,
  };
}
