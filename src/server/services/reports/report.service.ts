import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { env } from "@/lib/env";
import { formatLiters, startOfColomboDay } from "@/lib/format";
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

function distanceKm(odometer: number, previousOdometer: number): number {
  return Math.max(0, odometer - previousOdometer);
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
        vehicle: { select: { plateNumber: true } },
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
      { key: "odometer", label: "Odometer", type: "km" },
      { key: "kmPerLiter", label: "km/L", type: "kmpl" },
      { key: "status", label: "Status", type: "text" },
    ],
    rows: rows.map((row) => ({
      issuedAt: row.issuedAt.toISOString(),
      vehicle: row.vehicle.plateNumber,
      tank: row.tank.name,
      operator: row.operator.displayName,
      liters: dec(row.liters),
      odometer: row.odometer,
      kmPerLiter: row.kmPerLiter ? row.kmPerLiter.toNumber() : null,
      status: row.isAbnormal ? "Abnormal" : row.odometerOverride ? "Override" : "Issued",
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
            vehicleType: { select: { name: true, minKmPerLiter: true, maxKmPerLiter: true } },
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
      { key: "kmPerLiter", label: "km/L", type: "kmpl" },
      { key: "band", label: "Expected band", type: "text" },
    ],
    rows: rows.map((row) => ({
      issuedAt: row.issuedAt.toISOString(),
      vehicle: row.vehicle.plateNumber,
      vehicleType: row.vehicle.vehicleType.name,
      tank: row.tank.name,
      liters: dec(row.liters),
      kmPerLiter: row.kmPerLiter ? row.kmPerLiter.toNumber() : null,
      band: `${dec(row.vehicle.vehicleType.minKmPerLiter).toFixed(1)}–${dec(row.vehicle.vehicleType.maxKmPerLiter).toFixed(1)} km/L`,
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
        (row.delivery ? (row.delivery.supplierName ?? row.delivery.referenceNo ?? "Delivery") : null) ??
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
  issuedAt: Date;
  liters: number;
  odometer: number;
  previousOdometer: number;
  kmPerLiter: number | null;
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
      vehicle: { select: { plateNumber: true, vehicleType: { select: { name: true } } } },
    },
  });
  const truncated = rows.length > MAX_SCAN;
  const fills = (truncated ? rows.slice(0, MAX_SCAN) : rows).map((row) => ({
    vehicleId: row.vehicleId,
    plateNumber: row.vehicle.plateNumber,
    vehicleTypeName: row.vehicle.vehicleType.name,
    issuedAt: row.issuedAt,
    liters: dec(row.liters),
    odometer: row.odometer,
    previousOdometer: row.previousOdometer,
    kmPerLiter: row.kmPerLiter ? row.kmPerLiter.toNumber() : null,
    isAbnormal: row.isAbnormal,
  }));
  return { fills, truncated };
}

async function runVehicleMonthly(
  actor: Actor,
  filters: ReportFilters,
  options: ReportRunOptions,
): Promise<RawResult> {
  const { fills, truncated } = await scanFills(actor, filters);

  const groups = new Map<
    string,
    { monthKey: string; month: string; plate: string; type: string; fills: number; liters: number; km: number }
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
        fills: 0,
        liters: 0,
        km: 0,
      };
      groups.set(key, group);
    }
    group.fills += 1;
    group.liters += fill.liters;
    group.km += distanceKm(fill.odometer, fill.previousOdometer);
  }

  const ordered = [...groups.values()].sort(
    (a, b) => a.plate.localeCompare(b.plate) || a.monthKey.localeCompare(b.monthKey),
  );
  const totalRows = ordered.length;
  const totalLiters = ordered.reduce((sum, group) => sum + group.liters, 0);

  return {
    columns: [
      { key: "month", label: "Month", type: "text" },
      { key: "vehicle", label: "Vehicle", type: "text" },
      { key: "vehicleType", label: "Type", type: "text" },
      { key: "fills", label: "Fills", type: "number" },
      { key: "liters", label: "Liters", type: "liters" },
      { key: "km", label: "Distance", type: "km" },
      { key: "kmPerLiter", label: "km/L", type: "kmpl" },
    ],
    rows: ordered.slice(0, options.rowLimit).map((group) => ({
      month: group.month,
      vehicle: group.plate,
      vehicleType: group.type,
      fills: group.fills,
      liters: group.liters,
      km: group.km,
      kmPerLiter: group.liters > 0 ? Math.round((group.km / group.liters) * 100) / 100 : null,
    })),
    summary: [
      { label: "Rows", value: totalRows.toLocaleString("en-US") },
      { label: "Total liters", value: formatLiters(totalLiters) },
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
    { vehicleId: string; plate: string; type: string; fills: number; liters: number; km: number; abnormal: number }
  >();
  for (const fill of fills) {
    let group = groups.get(fill.vehicleId);
    if (!group) {
      group = {
        vehicleId: fill.vehicleId,
        plate: fill.plateNumber,
        type: fill.vehicleTypeName,
        fills: 0,
        liters: 0,
        km: 0,
        abnormal: 0,
      };
      groups.set(fill.vehicleId, group);
    }
    group.fills += 1;
    group.liters += fill.liters;
    group.km += distanceKm(fill.odometer, fill.previousOdometer);
    if (fill.isAbnormal) group.abnormal += 1;
  }

  const rows = [...groups.values()].map((group) => ({
    vehicleId: group.vehicleId,
    plate: group.plate,
    type: group.type,
    fills: group.fills,
    liters: group.liters,
    km: group.km,
    kmPerLiter: group.liters > 0 ? Math.round((group.km / group.liters) * 100) / 100 : null,
    abnormal: group.abnormal,
  }));
  // Worst efficiency first; vehicles without a computable km/L sort last.
  rows.sort((a, b) => (a.kmPerLiter ?? Infinity) - (b.kmPerLiter ?? Infinity));

  const totalLiters = rows.reduce((sum, row) => sum + row.liters, 0);
  const totalKm = rows.reduce((sum, row) => sum + row.km, 0);

  return {
    columns: [
      { key: "plate", label: "Vehicle", type: "text" },
      { key: "type", label: "Type", type: "text" },
      { key: "fills", label: "Fills", type: "number" },
      { key: "liters", label: "Liters", type: "liters" },
      { key: "km", label: "Distance", type: "km" },
      { key: "kmPerLiter", label: "km/L", type: "kmpl" },
      { key: "abnormal", label: "Abnormal", type: "number" },
    ],
    rows: rows.slice(0, options.rowLimit).map((row) => ({
      // `_vehicleId` is carried for the drill-down link; it is not a column, so
      // CSV/XLSX never emit it.
      _vehicleId: row.vehicleId,
      plate: row.plate,
      type: row.type,
      fills: row.fills,
      liters: row.liters,
      km: row.km,
      kmPerLiter: row.kmPerLiter,
      abnormal: row.abnormal,
    })),
    summary: [
      { label: "Vehicles", value: rows.length.toLocaleString("en-US") },
      {
        label: "Fleet km/L",
        value: totalLiters > 0 ? (totalKm / totalLiters).toFixed(2) : "—",
      },
    ],
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

  const driverIds = grouped.map((group) => group.driverId).filter((id): id is string => id !== null);
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
      { label: "Total liters", value: formatLiters(rows.reduce((sum, row) => sum + row.liters, 0)) },
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
  vehicle: { id: string; plateNumber: string; vehicleType: string; fuelType: string; currentOdometer: number };
  totals: { fills: number; liters: number; km: number; kmPerLiter: number | null };
  fills: {
    issuedAt: string;
    tank: string;
    liters: number;
    odometer: number;
    distanceKm: number;
    kmPerLiter: number | null;
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
    include: { vehicleType: { select: { name: true } } },
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
  let totalKm = 0;
  const fills = rows.map((row) => {
    const liters = dec(row.liters);
    const km = distanceKm(row.odometer, row.previousOdometer);
    totalLiters += liters;
    totalKm += km;
    return {
      issuedAt: row.issuedAt.toISOString(),
      tank: row.tank.name,
      liters,
      odometer: row.odometer,
      distanceKm: km,
      kmPerLiter: row.kmPerLiter ? row.kmPerLiter.toNumber() : null,
      isAbnormal: row.isAbnormal,
    };
  });

  return {
    vehicle: {
      id: vehicle.id,
      plateNumber: vehicle.plateNumber,
      vehicleType: vehicle.vehicleType.name,
      fuelType: vehicle.fuelType,
      currentOdometer: vehicle.currentOdometer,
    },
    totals: {
      fills: fills.length,
      liters: totalLiters,
      km: totalKm,
      kmPerLiter: totalLiters > 0 ? Math.round((totalKm / totalLiters) * 100) / 100 : null,
    },
    fills,
  };
}
