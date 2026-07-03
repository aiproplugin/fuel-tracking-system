import type { MovementType } from "@prisma/client";
import { startOfColomboDay } from "@/lib/format";
import { db } from "@/server/db";
import { effectiveSiteId, type Actor } from "@/server/services/actor";
import type { DashboardRange } from "@/lib/schemas/dashboard";

/**
 * DASHBOARD READ MODEL (D1). A single aggregation so the page makes one server
 * call. Everything here is DERIVED from the append-only ledger and the
 * FuelTransaction flags — no mutable dashboard state exists.
 *
 * Scoping is enforced here, not trusted from the client:
 *  - SUPERVISOR is pinned to their own site; a supplied `siteId` is ignored.
 *  - MANAGER/ADMIN see all sites, optionally narrowed to one `siteId`.
 * OPERATOR never reaches this service (router gate is supervisor+).
 */

const DAY_MS = 24 * 3_600_000;
const RECENT_LIMIT = 8;
const QUEUE_CATEGORY_LIMIT = 5;

const weekdayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  weekday: "short",
});

export interface DashboardKpis {
  volumeLiters: number;
  petrolStockLiters: number;
  dieselStockLiters: number;
  lowStockTanks: number;
  odometerExceptionsPending: number;
  abnormalConsumption: number;
}

export interface DailyLitersPoint {
  date: string;
  label: string;
  liters: number;
}

export type ExceptionKind = "ODOMETER" | "LOW_STOCK" | "EFFICIENCY";

export interface ExceptionQueueItem {
  id: string;
  kind: ExceptionKind;
  title: string;
  detail: string;
}

export interface RecentTransaction {
  id: string;
  type: MovementType;
  vehicleLabel: string | null;
  tankName: string;
  liters: number;
  balanceAfterLiters: number;
  status: "ISSUED" | "FLAGGED" | "DELIVERY" | "ADJUSTMENT";
  occurredAt: Date;
}

export interface DashboardSummary {
  range: DashboardRange;
  siteId: string | null;
  generatedAt: Date;
  kpis: DashboardKpis;
  dailyLiters: DailyLitersPoint[];
  exceptionQueue: ExceptionQueueItem[];
  recentTransactions: RecentTransaction[];
}

/**
 * Build the D1 dashboard read model for the given actor and filters.
 *
 * @param actor  Authenticated principal (role + site) constructed by the router.
 * @param input  Validated filters: `range` (volume window) and optional `siteId`.
 * @returns      KPIs, a 7-day daily-liters series, the alert queue, and the
 *               latest ledger activity — all role/site scoped.
 */
export async function getDashboardSummary(
  actor: Actor,
  input: { range: DashboardRange; siteId?: string },
): Promise<DashboardSummary> {
  const siteId = effectiveSiteId(actor, input.siteId);

  // Scope fragments: `tankWhere` for tank rows, `relWhere` for rows that reach
  // a tank via relation (transactions, movements, exceptions).
  const tankWhere = siteId ? { siteId } : {};
  const relWhere = siteId ? { tank: { siteId } } : {};

  const now = new Date();
  const todayStart = startOfColomboDay(now);

  // Seven trailing Colombo days (oldest first). Sri Lanka has no DST, so each
  // day is exactly 24h and simple arithmetic on the midnight instant is safe.
  const buckets = Array.from({ length: 7 }, (_, index) => {
    const start = new Date(todayStart.getTime() - (6 - index) * DAY_MS);
    return { start, end: new Date(start.getTime() + DAY_MS), liters: 0 };
  });
  const weekStart = buckets[0]!.start;
  const volumeWindowStart = input.range === "TODAY" ? todayStart : weekStart;

  const [tanks, weekTransactions, pendingExceptionCount, pendingExceptions, abnormalRecent, movements] =
    await Promise.all([
      db.tank.findMany({
        where: { ...tankWhere, isActive: true },
        select: { fuelType: true, currentStock: true, lowStockThreshold: true, name: true },
      }),
      // One scan of the 7-day window feeds both the chart and the volume/abnormal KPIs.
      db.fuelTransaction.findMany({
        where: { ...relWhere, issuedAt: { gte: weekStart } },
        select: { issuedAt: true, liters: true, isAbnormal: true },
      }),
      db.odometerException.count({ where: { status: "PENDING", ...relWhere } }),
      db.odometerException.findMany({
        where: { status: "PENDING", ...relWhere },
        orderBy: { createdAt: "asc" },
        take: QUEUE_CATEGORY_LIMIT,
        select: {
          id: true,
          attemptedOdometer: true,
          previousOdometer: true,
          vehicle: { select: { plateNumber: true } },
          tank: { select: { name: true } },
        },
      }),
      db.fuelTransaction.findMany({
        where: { ...relWhere, isAbnormal: true, issuedAt: { gte: weekStart } },
        orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
        take: QUEUE_CATEGORY_LIMIT,
        select: {
          id: true,
          kmPerLiter: true,
          vehicle: { select: { plateNumber: true } },
          tank: { select: { name: true } },
        },
      }),
      db.stockMovement.findMany({
        where: relWhere,
        orderBy: { id: "desc" },
        take: RECENT_LIMIT,
        select: {
          id: true,
          type: true,
          quantity: true,
          balanceAfter: true,
          createdAt: true,
          tank: { select: { name: true } },
          fuelTransaction: {
            select: { issuedAt: true, isAbnormal: true, vehicle: { select: { plateNumber: true } } },
          },
          delivery: { select: { deliveredAt: true, supplierName: true } },
          adjustment: { select: { adjustedAt: true } },
        },
      }),
    ]);

  // --- Chart + volume/abnormal KPIs (single pass over the 7-day window) ------
  let volumeLiters = 0;
  let abnormalConsumption = 0;
  for (const txn of weekTransactions) {
    const liters = txn.liters.toNumber();
    const at = txn.issuedAt.getTime();
    const bucket = buckets.find((candidate) => at >= candidate.start.getTime() && at < candidate.end.getTime());
    if (bucket) bucket.liters += liters;
    if (at >= volumeWindowStart.getTime()) {
      volumeLiters += liters;
      if (txn.isAbnormal) abnormalConsumption += 1;
    }
  }

  // --- Stock KPIs ------------------------------------------------------------
  const sumStock = (fuelType: "PETROL" | "DIESEL") =>
    tanks
      .filter((tank) => tank.fuelType === fuelType)
      .reduce((total, tank) => total + tank.currentStock.toNumber(), 0);

  const lowStockTanks = tanks.filter((tank) => tank.currentStock.lessThan(tank.lowStockThreshold));

  // --- Exception / alert queue ----------------------------------------------
  const exceptionQueue: ExceptionQueueItem[] = [
    ...pendingExceptions.map((row) => ({
      id: `odo-${row.id}`,
      kind: "ODOMETER" as const,
      title: row.vehicle.plateNumber,
      detail: `Attempted ${row.attemptedOdometer.toLocaleString("en-US")} km (last ${row.previousOdometer.toLocaleString("en-US")} km) · ${row.tank.name}`,
    })),
    ...lowStockTanks.slice(0, QUEUE_CATEGORY_LIMIT).map((tank) => ({
      id: `low-${tank.name}`,
      kind: "LOW_STOCK" as const,
      title: tank.name,
      detail: `Stock ${tank.currentStock.toNumber().toLocaleString("en-US")} L below threshold ${tank.lowStockThreshold.toNumber().toLocaleString("en-US")} L`,
    })),
    ...abnormalRecent.map((row) => ({
      id: `eff-${row.id}`,
      kind: "EFFICIENCY" as const,
      title: row.vehicle.plateNumber,
      detail: `${row.kmPerLiter ? `${row.kmPerLiter.toNumber().toFixed(2)} km/L · ` : ""}outside configured band · ${row.tank.name}`,
    })),
  ];

  // --- Recent ledger activity ------------------------------------------------
  const recentTransactions: RecentTransaction[] = movements.map((movement) => {
    const isAbnormal = movement.fuelTransaction?.isAbnormal ?? false;
    const status: RecentTransaction["status"] =
      movement.type === "ISSUE"
        ? isAbnormal
          ? "FLAGGED"
          : "ISSUED"
        : movement.type === "DELIVERY"
          ? "DELIVERY"
          : "ADJUSTMENT";
    const occurredAt =
      movement.fuelTransaction?.issuedAt ??
      movement.delivery?.deliveredAt ??
      movement.adjustment?.adjustedAt ??
      movement.createdAt;
    const vehicleLabel =
      movement.fuelTransaction?.vehicle.plateNumber ?? movement.delivery?.supplierName ?? null;
    return {
      id: movement.id.toString(),
      type: movement.type,
      vehicleLabel,
      tankName: movement.tank.name,
      liters: movement.quantity.toNumber(),
      balanceAfterLiters: movement.balanceAfter.toNumber(),
      status,
      occurredAt,
    };
  });

  return {
    range: input.range,
    siteId: siteId === "__none__" ? null : (siteId ?? null),
    generatedAt: now,
    kpis: {
      volumeLiters,
      petrolStockLiters: sumStock("PETROL"),
      dieselStockLiters: sumStock("DIESEL"),
      lowStockTanks: lowStockTanks.length,
      odometerExceptionsPending: pendingExceptionCount,
      abnormalConsumption,
    },
    dailyLiters: buckets.map((bucket) => ({
      date: bucket.start.toISOString(),
      label: weekdayFormatter.format(bucket.start),
      liters: bucket.liters,
    })),
    exceptionQueue,
    recentTransactions,
  };
}
