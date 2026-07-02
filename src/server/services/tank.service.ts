import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db";
import { siteScopeWhere, type Actor } from "@/server/services/actor";
import { recordAuditEvent } from "@/server/services/audit.service";

/**
 * Tank list scoped by role (supervisor = own site). Decimals are converted
 * to numbers at this boundary.
 */
export async function listTanks(actor: Actor) {
  const tanks = await db.tank.findMany({
    where: siteScopeWhere(actor),
    orderBy: { name: "asc" },
    include: {
      site: { select: { id: true, name: true } },
      operators: { select: { id: true, displayName: true } },
    },
  });
  return tanks.map((tank) => ({
    id: tank.id,
    name: tank.name,
    site: tank.site,
    fuelType: tank.fuelType,
    capacityLiters: tank.capacityLiters.toNumber(),
    currentStockLiters: tank.currentStock.toNumber(),
    lowStockThreshold: tank.lowStockThreshold.toNumber(),
    isLow: tank.currentStock.lessThan(tank.lowStockThreshold),
    isActive: tank.isActive,
    operators: tank.operators,
  }));
}

/** Aggregate stock KPIs for the dashboard. */
export async function getStockSummary(actor: Actor) {
  const tanks = await listTanks(actor);
  const active = tanks.filter((tank) => tank.isActive);
  const sum = (fuelType: "PETROL" | "DIESEL") =>
    active
      .filter((tank) => tank.fuelType === fuelType)
      .reduce((total, tank) => total + tank.currentStockLiters, 0);
  return {
    petrolStockLiters: sum("PETROL"),
    dieselStockLiters: sum("DIESEL"),
    lowStockTanks: active.filter((tank) => tank.isLow).length,
    tankCount: active.length,
  };
}

/**
 * Create a tank (ADMIN). Stock starts at 0 — fuel only ever enters through
 * DELIVERY ledger movements (Phase 4), never as a typed-in balance.
 */
export async function createTank(
  actorId: string,
  input: {
    name: string;
    siteId: string;
    fuelType: "PETROL" | "DIESEL";
    capacityLiters: number;
    lowStockThreshold: number;
  },
) {
  try {
    const tank = await db.tank.create({
      data: {
        name: input.name,
        siteId: input.siteId,
        fuelType: input.fuelType,
        capacityLiters: new Prisma.Decimal(input.capacityLiters),
        lowStockThreshold: new Prisma.Decimal(input.lowStockThreshold),
      },
    });
    await recordAuditEvent({
      actorId,
      action: "TANK_CREATED",
      entityType: "tank",
      entityId: tank.id,
      after: { name: input.name, fuelType: input.fuelType, capacity: input.capacityLiters },
    });
    return { id: tank.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new TRPCError({ code: "CONFLICT", message: "A tank with this name already exists." });
    }
    throw error;
  }
}

/**
 * Update a tank (ADMIN). Fuel type is intentionally NOT editable: a tank
 * with ledger history changing fuel type would corrupt every efficiency
 * and mismatch rule downstream.
 */
export async function updateTank(
  actorId: string,
  input: {
    id: string;
    name: string;
    capacityLiters: number;
    lowStockThreshold: number;
    isActive: boolean;
  },
) {
  const before = await db.tank.findUnique({ where: { id: input.id } });
  if (!before) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Tank not found." });
  }

  try {
    await db.tank.update({
      where: { id: input.id },
      data: {
        name: input.name,
        capacityLiters: new Prisma.Decimal(input.capacityLiters),
        lowStockThreshold: new Prisma.Decimal(input.lowStockThreshold),
        isActive: input.isActive,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new TRPCError({ code: "CONFLICT", message: "A tank with this name already exists." });
    }
    throw error;
  }

  await recordAuditEvent({
    actorId,
    action: "TANK_UPDATED",
    entityType: "tank",
    entityId: input.id,
    before: {
      name: before.name,
      capacity: before.capacityLiters.toNumber(),
      threshold: before.lowStockThreshold.toNumber(),
      isActive: before.isActive,
    },
    after: {
      name: input.name,
      capacity: input.capacityLiters,
      threshold: input.lowStockThreshold,
      isActive: input.isActive,
    },
  });
}
