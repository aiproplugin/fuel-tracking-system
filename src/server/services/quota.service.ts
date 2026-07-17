import { createHash, randomInt } from "node:crypto";
import {
  Prisma,
  type QuotaEnforcementMode,
  type QuotaMode,
  type QuotaPeriod,
  type WeekStartDay,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { currentColomboWindow } from "@/lib/format";
import { db } from "@/server/db";
import { createRateLimiter } from "@/server/security/rate-limit";
import { type Actor, effectiveSiteId } from "@/server/services/actor";
import { recordAuditEvent } from "@/server/services/audit.service";

/**
 * FUEL QUOTA CORE.
 *
 * A quota is ALWAYS an (amount in litres + period) PAIR that travels together:
 * resolution walks the waterfall individual -> company -> vehicle type ->
 * global -> none, and the WINNING LAYER supplies BOTH values — amount and
 * period are never resolved through separate waterfalls, so they cannot
 * desync. Consumption is always derived from the fuel_transaction ledger
 * inside the current window of the resolved period (same integrity principle
 * as the stock ledger) — never a stored running counter.
 */

// ---------------------------------------------------------------------------
// Settings (singleton row, id = 1; in-code defaults until first save)
// ---------------------------------------------------------------------------

export interface QuotaSettingsValues {
  enforcementEnabled: boolean;
  enforcementMode: QuotaEnforcementMode;
  warningThresholdPct: number;
  weekStartDay: WeekStartDay;
  globalQuotaLiters: number | null;
  globalQuotaPeriod: QuotaPeriod | null;
}

/** Master switch OFF out of the box: deploying quotas changes nothing until enabled. */
export const DEFAULT_QUOTA_SETTINGS: QuotaSettingsValues = {
  enforcementEnabled: false,
  enforcementMode: "WARN_OVERRIDE",
  warningThresholdPct: 80,
  weekStartDay: "MONDAY",
  globalQuotaLiters: null,
  globalQuotaPeriod: null,
};

export async function getQuotaSettings(): Promise<QuotaSettingsValues> {
  const row = await db.quotaSettings.findUnique({ where: { id: 1 } });
  if (!row) return DEFAULT_QUOTA_SETTINGS;
  return {
    enforcementEnabled: row.enforcementEnabled,
    enforcementMode: row.enforcementMode,
    warningThresholdPct: row.warningThresholdPct,
    weekStartDay: row.weekStartDay,
    globalQuotaLiters: row.globalQuotaLiters?.toNumber() ?? null,
    globalQuotaPeriod: row.globalQuotaPeriod,
  };
}

export async function updateQuotaSettings(
  actorId: string,
  input: {
    enforcementEnabled: boolean;
    enforcementMode: QuotaEnforcementMode;
    warningThresholdPct: number;
    weekStartDay: WeekStartDay;
    globalQuota: { liters: number; period: QuotaPeriod } | null;
  },
): Promise<QuotaSettingsValues> {
  const before = await getQuotaSettings();
  const data = {
    enforcementEnabled: input.enforcementEnabled,
    enforcementMode: input.enforcementMode,
    warningThresholdPct: input.warningThresholdPct,
    weekStartDay: input.weekStartDay,
    globalQuotaLiters:
      input.globalQuota !== null ? new Prisma.Decimal(input.globalQuota.liters.toFixed(2)) : null,
    globalQuotaPeriod: input.globalQuota?.period ?? null,
  };
  await db.quotaSettings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });

  const after = await getQuotaSettings();
  await recordAuditEvent({
    actorId,
    action: "QUOTA_SETTINGS_CHANGED",
    entityType: "quota_settings",
    entityId: "1",
    before: { ...before },
    after: { ...after },
  });
  return after;
}

// ---------------------------------------------------------------------------
// Resolution (pure) — individual -> company -> vehicle type -> global -> none
// ---------------------------------------------------------------------------

export type QuotaSource = "VEHICLE_CUSTOM" | "COMPANY_DEFAULT" | "TYPE_DEFAULT" | "GLOBAL_DEFAULT";

export type ResolvedQuota =
  | { status: "EXEMPT" }
  | { status: "UNLIMITED" }
  | { status: "QUOTA"; liters: number; period: QuotaPeriod; source: QuotaSource };

/** The vehicle slice resolution needs (Prisma row with company + vehicleType). */
export interface QuotaResolutionVehicle {
  quotaMode: QuotaMode;
  customQuotaLiters: Prisma.Decimal | null;
  customQuotaPeriod: QuotaPeriod | null;
  company: {
    defaultQuotaLiters: Prisma.Decimal | null;
    defaultQuotaPeriod: QuotaPeriod | null;
  };
  vehicleType: {
    defaultQuotaLiters: Prisma.Decimal | null;
    defaultQuotaPeriod: QuotaPeriod | null;
  };
}

function pairOf(
  liters: Prisma.Decimal | number | null,
  period: QuotaPeriod | null,
): { liters: number; period: QuotaPeriod } | null {
  // Both-or-neither is enforced by Zod + DB CHECK constraints; treating a
  // half-set pair as absent here fails safe rather than inventing a value.
  if (liters === null || period === null) return null;
  return { liters: typeof liters === "number" ? liters : liters.toNumber(), period };
}

/**
 * Resolve the vehicle's EFFECTIVE quota pair, most-specific-wins. The winning
 * layer supplies BOTH amount and period. EXEMPT short-circuits every default.
 * Resolution is independent of the master switch so admin screens can show
 * effective quotas even while enforcement is off.
 */
export function resolveVehicleQuota(
  vehicle: QuotaResolutionVehicle,
  settings: Pick<QuotaSettingsValues, "globalQuotaLiters" | "globalQuotaPeriod">,
): ResolvedQuota {
  if (vehicle.quotaMode === "EXEMPT") return { status: "EXEMPT" };

  if (vehicle.quotaMode === "CUSTOM") {
    const custom = pairOf(vehicle.customQuotaLiters, vehicle.customQuotaPeriod);
    if (custom) return { status: "QUOTA", ...custom, source: "VEHICLE_CUSTOM" };
    // CUSTOM without a pair cannot be created through the API; fall through
    // to the waterfall rather than granting unlimited fuel on bad data.
  }

  const company = pairOf(vehicle.company.defaultQuotaLiters, vehicle.company.defaultQuotaPeriod);
  if (company) return { status: "QUOTA", ...company, source: "COMPANY_DEFAULT" };

  const type = pairOf(
    vehicle.vehicleType.defaultQuotaLiters,
    vehicle.vehicleType.defaultQuotaPeriod,
  );
  if (type) return { status: "QUOTA", ...type, source: "TYPE_DEFAULT" };

  const global = pairOf(settings.globalQuotaLiters, settings.globalQuotaPeriod);
  if (global) return { status: "QUOTA", ...global, source: "GLOBAL_DEFAULT" };

  return { status: "UNLIMITED" };
}

// ---------------------------------------------------------------------------
// Consumption (ledger-derived) + usage snapshot
// ---------------------------------------------------------------------------

export interface QuotaUsage {
  resolved: ResolvedQuota;
  /** Null unless resolved.status === "QUOTA". */
  windowStart: Date | null;
  windowEnd: Date | null;
  quotaLiters: number | null;
  topUpLiters: number;
  /** Cap = quota + active top-ups for the current window. */
  capLiters: number | null;
  consumedLiters: number;
  remainingLiters: number | null;
  percentUsed: number | null;
  approaching: boolean;
}

type DbClient = Prisma.TransactionClient | typeof db;

/**
 * Live usage for one vehicle: the ledger sum of its fuel_transaction litres
 * inside the CURRENT window of its resolved period, plus active top-ups.
 * Accepts a transaction client so the fuel-issue flow can re-check
 * authoritatively inside its atomic transaction.
 */
export async function computeQuotaUsage(
  vehicleId: string,
  resolved: ResolvedQuota,
  settings: Pick<QuotaSettingsValues, "warningThresholdPct" | "weekStartDay">,
  now: Date,
  client: DbClient = db,
): Promise<QuotaUsage> {
  if (resolved.status !== "QUOTA") {
    return {
      resolved,
      windowStart: null,
      windowEnd: null,
      quotaLiters: null,
      topUpLiters: 0,
      capLiters: null,
      consumedLiters: 0,
      remainingLiters: null,
      percentUsed: null,
      approaching: false,
    };
  }

  const window = currentColomboWindow(resolved.period, now, settings.weekStartDay);
  const [consumedAgg, topUpAgg] = await Promise.all([
    client.fuelTransaction.aggregate({
      where: { vehicleId, issuedAt: { gte: window.start, lt: window.end } },
      _sum: { liters: true },
    }),
    client.quotaTopUp.aggregate({
      where: { vehicleId, windowStart: { lte: now }, windowEnd: { gt: now } },
      _sum: { liters: true },
    }),
  ]);

  const consumedLiters = consumedAgg._sum.liters?.toNumber() ?? 0;
  const topUpLiters = topUpAgg._sum.liters?.toNumber() ?? 0;
  const capLiters = resolved.liters + topUpLiters;
  const remainingLiters = Math.max(0, capLiters - consumedLiters);
  const percentUsed = capLiters > 0 ? (consumedLiters / capLiters) * 100 : 100;

  return {
    resolved,
    windowStart: window.start,
    windowEnd: window.end,
    quotaLiters: resolved.liters,
    topUpLiters,
    capLiters,
    consumedLiters,
    remainingLiters,
    percentUsed,
    approaching: percentUsed >= settings.warningThresholdPct,
  };
}

const VEHICLE_QUOTA_INCLUDE = {
  company: { select: { id: true, name: true, defaultQuotaLiters: true, defaultQuotaPeriod: true } },
  vehicleType: {
    select: { id: true, name: true, defaultQuotaLiters: true, defaultQuotaPeriod: true },
  },
} satisfies Prisma.VehicleInclude;

/** Effective quota + live usage for one vehicle (admin vehicle form display). */
export async function resolveVehicleQuotaDetail(input: { vehicleId: string }) {
  const vehicle = await db.vehicle.findUnique({
    where: { id: input.vehicleId },
    include: VEHICLE_QUOTA_INCLUDE,
  });
  if (!vehicle) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle not found." });
  }
  const settings = await getQuotaSettings();
  const resolved = resolveVehicleQuota(vehicle, settings);
  const usage = await computeQuotaUsage(vehicle.id, resolved, settings, new Date());
  return {
    plateNumber: vehicle.plateNumber,
    companyName: vehicle.company.name,
    quotaMode: vehicle.quotaMode,
    customQuota: pairOf(vehicle.customQuotaLiters, vehicle.customQuotaPeriod),
    enforcementEnabled: settings.enforcementEnabled,
    usage: toUsageDto(usage),
  };
}

// ---------------------------------------------------------------------------
// Layer assignment (ADMIN) — every write is a whole pair, audited
// ---------------------------------------------------------------------------

type QuotaPair = { liters: number; period: QuotaPeriod } | null;

function pairColumns(quota: QuotaPair) {
  return {
    liters: quota !== null ? new Prisma.Decimal(quota.liters.toFixed(2)) : null,
    period: quota?.period ?? null,
  };
}

function pairJson(liters: Prisma.Decimal | null, period: QuotaPeriod | null) {
  const pair = pairOf(liters, period);
  return pair ? { liters: pair.liters, period: pair.period } : null;
}

/** Set/clear the company-wide default pair. Audited as QUOTA_ASSIGNED. */
export async function setCompanyQuota(actorId: string, input: { companyId: string; quota: QuotaPair }) {
  const company = await db.company.findUnique({ where: { id: input.companyId } });
  if (!company) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Company not found." });
  }
  const columns = pairColumns(input.quota);
  await db.company.update({
    where: { id: company.id },
    data: { defaultQuotaLiters: columns.liters, defaultQuotaPeriod: columns.period },
  });
  await recordAuditEvent({
    actorId,
    action: "QUOTA_ASSIGNED",
    entityType: "company",
    entityId: company.id,
    before: { quota: pairJson(company.defaultQuotaLiters, company.defaultQuotaPeriod) },
    after: { quota: input.quota },
  });
}

/** Set/clear the vehicle-type default pair. Audited as QUOTA_ASSIGNED. */
export async function setVehicleTypeQuota(
  actorId: string,
  input: { vehicleTypeId: string; quota: QuotaPair },
) {
  const vehicleType = await db.vehicleType.findUnique({ where: { id: input.vehicleTypeId } });
  if (!vehicleType) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle type not found." });
  }
  const columns = pairColumns(input.quota);
  await db.vehicleType.update({
    where: { id: vehicleType.id },
    data: { defaultQuotaLiters: columns.liters, defaultQuotaPeriod: columns.period },
  });
  await recordAuditEvent({
    actorId,
    action: "QUOTA_ASSIGNED",
    entityType: "vehicle_type",
    entityId: vehicleType.id,
    before: { quota: pairJson(vehicleType.defaultQuotaLiters, vehicleType.defaultQuotaPeriod) },
    after: { quota: input.quota },
  });
}

/** Per-vehicle setting: INHERIT / CUSTOM(pair) / EXEMPT. Audited as QUOTA_ASSIGNED. */
export async function setVehicleQuota(
  actorId: string,
  input: { vehicleId: string; mode: QuotaMode; quota: QuotaPair },
) {
  const vehicle = await db.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle not found." });
  }
  const columns = pairColumns(input.mode === "CUSTOM" ? input.quota : null);
  await db.vehicle.update({
    where: { id: vehicle.id },
    data: {
      quotaMode: input.mode,
      customQuotaLiters: columns.liters,
      customQuotaPeriod: columns.period,
    },
  });
  await recordAuditEvent({
    actorId,
    action: "QUOTA_ASSIGNED",
    entityType: "vehicle",
    entityId: vehicle.id,
    before: {
      mode: vehicle.quotaMode,
      quota: pairJson(vehicle.customQuotaLiters, vehicle.customQuotaPeriod),
    },
    after: { mode: input.mode, quota: input.mode === "CUSTOM" ? input.quota : null },
  });
}

/**
 * Bulk assignment: set (CUSTOM pair) or clear (back to INHERIT) the individual
 * quota of every ACTIVE vehicle of a company, of a vehicle type, or "at a
 * site" (= vehicles that have ever fuelled at that site's tanks — vehicles
 * are not site-bound, so fuelling history is the site membership proxy).
 */
export async function bulkAssignQuota(
  actorId: string,
  input: { scope: "COMPANY" | "VEHICLE_TYPE" | "SITE"; scopeId: string; quota: QuotaPair },
) {
  const vehicleWhere: Prisma.VehicleWhereInput =
    input.scope === "COMPANY"
      ? { isActive: true, companyId: input.scopeId }
      : input.scope === "VEHICLE_TYPE"
        ? { isActive: true, vehicleTypeId: input.scopeId }
        : { isActive: true, fuelTransactions: { some: { tank: { siteId: input.scopeId } } } };

  const columns = pairColumns(input.quota);
  const result = await db.vehicle.updateMany({
    where: vehicleWhere,
    data: {
      quotaMode: input.quota !== null ? "CUSTOM" : "INHERIT",
      customQuotaLiters: columns.liters,
      customQuotaPeriod: columns.period,
    },
  });

  await recordAuditEvent({
    actorId,
    action: "QUOTA_ASSIGNED",
    entityType: "vehicle_bulk",
    entityId: input.scopeId,
    after: {
      scope: input.scope,
      scopeId: input.scopeId,
      quota: input.quota,
      vehiclesAffected: result.count,
    },
  });
  return { vehiclesAffected: result.count };
}

// ---------------------------------------------------------------------------
// Top-ups (ADMIN) — one-off extra litres for the CURRENT window only
// ---------------------------------------------------------------------------

export async function grantTopUp(
  actorId: string,
  input: { vehicleId: string; liters: number; reason: string },
) {
  const vehicle = await db.vehicle.findUnique({
    where: { id: input.vehicleId },
    include: VEHICLE_QUOTA_INCLUDE,
  });
  if (!vehicle || !vehicle.isActive) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle not found." });
  }

  const settings = await getQuotaSettings();
  const resolved = resolveVehicleQuota(vehicle, settings);
  if (resolved.status !== "QUOTA") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This vehicle has no active quota to top up.",
    });
  }

  const window = currentColomboWindow(resolved.period, new Date(), settings.weekStartDay);
  const topUp = await db.quotaTopUp.create({
    data: {
      vehicleId: vehicle.id,
      liters: new Prisma.Decimal(input.liters.toFixed(2)),
      reason: input.reason,
      grantedById: actorId,
      windowStart: window.start,
      windowEnd: window.end,
    },
  });

  await recordAuditEvent({
    actorId,
    action: "QUOTA_TOPUP",
    entityType: "quota_top_up",
    entityId: topUp.id,
    after: {
      vehicleId: vehicle.id,
      plateNumber: vehicle.plateNumber,
      liters: input.liters,
      reason: input.reason,
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
    },
  });
  return { topUpId: topUp.id, windowEnd: window.end };
}

// ---------------------------------------------------------------------------
// Override codes (SUPERVISOR+) — single-use authorisation for one over-quota fill
// ---------------------------------------------------------------------------

export const OVERRIDE_CODE_TTL_MS = 10 * 60_000;

const issueCodeLimiter = createRateLimiter({ limit: 10, windowMs: 5 * 60_000 });

export function hashOverrideCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Mint a 6-digit single-use override code for one vehicle. Only the sha256
 * hash is stored; the plaintext is returned ONCE to the issuing supervisor
 * and never logged or audited. Short TTL + single use + per-issuer rate
 * limit protect the small code space.
 */
export async function issueOverrideCode(
  actor: Actor,
  input: { vehicleId: string; reason: string },
) {
  if (!issueCodeLimiter.consume(actor.id).allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many codes issued. Wait a few minutes and try again.",
    });
  }

  const vehicle = await db.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle || !vehicle.isActive) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle not found." });
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(Date.now() + OVERRIDE_CODE_TTL_MS);
  const row = await db.quotaOverrideCode.create({
    data: {
      codeHash: hashOverrideCode(code),
      vehicleId: vehicle.id,
      issuedById: actor.id,
      reason: input.reason,
      expiresAt,
    },
  });

  await recordAuditEvent({
    actorId: actor.id,
    action: "QUOTA_OVERRIDE_CODE_ISSUED",
    entityType: "quota_override_code",
    entityId: row.id,
    after: {
      vehicleId: vehicle.id,
      plateNumber: vehicle.plateNumber,
      reason: input.reason,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return { code, expiresAt, plateNumber: vehicle.plateNumber };
}

// ---------------------------------------------------------------------------
// Quota status view (SUPERVISOR+ dashboard)
// ---------------------------------------------------------------------------

/** How far back "active at this site" looks — covers the longest period window. */
const SITE_ACTIVITY_WINDOW_MS = 31 * 24 * 3_600_000;

export type QuotaVehicleState = "EXEMPT" | "UNLIMITED" | "OK" | "APPROACHING" | "OVER";

function usageState(usage: QuotaUsage): QuotaVehicleState {
  if (usage.resolved.status === "EXEMPT") return "EXEMPT";
  if (usage.resolved.status === "UNLIMITED") return "UNLIMITED";
  if (usage.capLiters !== null && usage.consumedLiters > usage.capLiters) return "OVER";
  return usage.approaching ? "APPROACHING" : "OK";
}

function toUsageDto(usage: QuotaUsage) {
  return {
    status: usage.resolved.status,
    liters: usage.quotaLiters,
    period: usage.resolved.status === "QUOTA" ? usage.resolved.period : null,
    source: usage.resolved.status === "QUOTA" ? usage.resolved.source : null,
    topUpLiters: usage.topUpLiters,
    capLiters: usage.capLiters,
    consumedLiters: usage.consumedLiters,
    remainingLiters: usage.remainingLiters,
    percentUsed: usage.percentUsed !== null ? Math.round(usage.percentUsed * 10) / 10 : null,
    windowEnd: usage.windowEnd,
    state: usageState(usage),
  };
}

/**
 * Vehicle quota list + per-company summary. SUPERVISOR is scoped to vehicles
 * that recently fuelled at their own site's tanks (vehicles are not
 * site-bound); MANAGER/ADMIN see all, optionally narrowed to one site.
 * Consumption always counts the vehicle's fuelling group-wide, inside each
 * vehicle's OWN resolved period window (mixed periods measure independently).
 */
export async function getQuotaStatus(actor: Actor, input: { siteId?: string }) {
  const settings = await getQuotaSettings();
  const siteId = effectiveSiteId(actor, input.siteId);
  const now = new Date();

  const vehicles = await db.vehicle.findMany({
    where: {
      isActive: true,
      ...(siteId
        ? {
            fuelTransactions: {
              some: {
                tank: { siteId },
                issuedAt: { gte: new Date(now.getTime() - SITE_ACTIVITY_WINDOW_MS) },
              },
            },
          }
        : {}),
    },
    include: VEHICLE_QUOTA_INCLUDE,
    orderBy: { plateNumber: "asc" },
  });

  // Batch the ledger sums: one groupBy per distinct period window + one for
  // active top-ups, instead of two aggregates per vehicle.
  const resolvedByVehicle = new Map(
    vehicles.map((vehicle) => [vehicle.id, resolveVehicleQuota(vehicle, settings)] as const),
  );
  const periods = new Set<QuotaPeriod>();
  for (const resolved of resolvedByVehicle.values()) {
    if (resolved.status === "QUOTA") periods.add(resolved.period);
  }

  const consumedByVehicle = new Map<string, number>();
  await Promise.all(
    [...periods].map(async (period) => {
      const window = currentColomboWindow(period, now, settings.weekStartDay);
      const ids = vehicles
        .filter((vehicle) => {
          const resolved = resolvedByVehicle.get(vehicle.id);
          return resolved?.status === "QUOTA" && resolved.period === period;
        })
        .map((vehicle) => vehicle.id);
      const groups = await db.fuelTransaction.groupBy({
        by: ["vehicleId"],
        where: { vehicleId: { in: ids }, issuedAt: { gte: window.start, lt: window.end } },
        _sum: { liters: true },
      });
      for (const group of groups) {
        consumedByVehicle.set(group.vehicleId, group._sum.liters?.toNumber() ?? 0);
      }
    }),
  );

  const topUpGroups = await db.quotaTopUp.groupBy({
    by: ["vehicleId"],
    where: {
      vehicleId: { in: vehicles.map((vehicle) => vehicle.id) },
      windowStart: { lte: now },
      windowEnd: { gt: now },
    },
    _sum: { liters: true },
  });
  const topUpByVehicle = new Map(
    topUpGroups.map((group) => [group.vehicleId, group._sum.liters?.toNumber() ?? 0] as const),
  );

  const rows = vehicles.map((vehicle) => {
    const resolved = resolvedByVehicle.get(vehicle.id) ?? { status: "UNLIMITED" as const };
    let usage: ReturnType<typeof toUsageDto>;
    if (resolved.status !== "QUOTA") {
      usage = toUsageDto({
        resolved,
        windowStart: null,
        windowEnd: null,
        quotaLiters: null,
        topUpLiters: 0,
        capLiters: null,
        consumedLiters: 0,
        remainingLiters: null,
        percentUsed: null,
        approaching: false,
      });
    } else {
      const window = currentColomboWindow(resolved.period, now, settings.weekStartDay);
      const consumedLiters = consumedByVehicle.get(vehicle.id) ?? 0;
      const topUpLiters = topUpByVehicle.get(vehicle.id) ?? 0;
      const capLiters = resolved.liters + topUpLiters;
      const percentUsed = capLiters > 0 ? (consumedLiters / capLiters) * 100 : 100;
      usage = toUsageDto({
        resolved,
        windowStart: window.start,
        windowEnd: window.end,
        quotaLiters: resolved.liters,
        topUpLiters,
        capLiters,
        consumedLiters,
        remainingLiters: Math.max(0, capLiters - consumedLiters),
        percentUsed,
        approaching: percentUsed >= settings.warningThresholdPct,
      });
    }
    return {
      vehicleId: vehicle.id,
      plateNumber: vehicle.plateNumber,
      companyId: vehicle.company.id,
      companyName: vehicle.company.name,
      vehicleTypeName: vehicle.vehicleType.name,
      quotaMode: vehicle.quotaMode,
      ...usage,
    };
  });

  // Per-company aggregate position over quota-carrying vehicles only —
  // unlimited/exempt vehicles have no cap so they cannot enter the math.
  const companies = new Map<
    string,
    {
      companyId: string;
      companyName: string;
      vehicleCount: number;
      quotaVehicleCount: number;
      totalQuotaLiters: number;
      consumedLiters: number;
      remainingLiters: number;
      overCount: number;
      approachingCount: number;
    }
  >();
  for (const row of rows) {
    let entry = companies.get(row.companyId);
    if (!entry) {
      entry = {
        companyId: row.companyId,
        companyName: row.companyName,
        vehicleCount: 0,
        quotaVehicleCount: 0,
        totalQuotaLiters: 0,
        consumedLiters: 0,
        remainingLiters: 0,
        overCount: 0,
        approachingCount: 0,
      };
      companies.set(row.companyId, entry);
    }
    entry.vehicleCount += 1;
    if (row.status === "QUOTA" && row.capLiters !== null && row.remainingLiters !== null) {
      entry.quotaVehicleCount += 1;
      entry.totalQuotaLiters += row.capLiters;
      entry.consumedLiters += row.consumedLiters;
      entry.remainingLiters += row.remainingLiters;
      if (row.state === "OVER") entry.overCount += 1;
      if (row.state === "APPROACHING") entry.approachingCount += 1;
    }
  }

  const companySummary = [...companies.values()]
    .map((entry) => ({
      ...entry,
      percentUsed:
        entry.totalQuotaLiters > 0
          ? Math.round((entry.consumedLiters / entry.totalQuotaLiters) * 1000) / 10
          : null,
    }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName));

  return {
    settings: {
      enforcementEnabled: settings.enforcementEnabled,
      enforcementMode: settings.enforcementMode,
      warningThresholdPct: settings.warningThresholdPct,
    },
    vehicles: rows.sort((a, b) => (b.percentUsed ?? -1) - (a.percentUsed ?? -1)),
    companySummary,
  };
}
