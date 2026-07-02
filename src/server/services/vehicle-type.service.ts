import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db";
import { recordAuditEvent } from "@/server/services/audit.service";

/** Vehicle types with their abnormal-consumption bands (Settings screen). */
export async function listVehicleTypes() {
  const types = await db.vehicleType.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { vehicles: true } } },
  });
  return types.map((type) => ({
    id: type.id,
    name: type.name,
    minKmPerLiter: type.minKmPerLiter.toNumber(),
    maxKmPerLiter: type.maxKmPerLiter.toNumber(),
    vehicleCount: type._count.vehicles,
  }));
}

/**
 * Create or update a vehicle type's km/L band (ADMIN, Settings).
 * min < max is enforced by the input schema; changes are audited as
 * SETTINGS_CHANGED with before/after so band history is reconstructible.
 */
export async function upsertVehicleType(
  actorId: string,
  input: { id?: string; name: string; minKmPerLiter: number; maxKmPerLiter: number },
) {
  const data = {
    name: input.name,
    minKmPerLiter: new Prisma.Decimal(input.minKmPerLiter),
    maxKmPerLiter: new Prisma.Decimal(input.maxKmPerLiter),
  };

  try {
    if (input.id) {
      const before = await db.vehicleType.findUnique({ where: { id: input.id } });
      if (!before) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle type not found." });
      }
      const updated = await db.vehicleType.update({ where: { id: input.id }, data });
      await recordAuditEvent({
        actorId,
        action: "SETTINGS_CHANGED",
        entityType: "vehicle_type",
        entityId: updated.id,
        before: {
          name: before.name,
          minKmPerLiter: before.minKmPerLiter.toNumber(),
          maxKmPerLiter: before.maxKmPerLiter.toNumber(),
        },
        after: {
          name: input.name,
          minKmPerLiter: input.minKmPerLiter,
          maxKmPerLiter: input.maxKmPerLiter,
        },
      });
      return { id: updated.id };
    }

    const created = await db.vehicleType.create({ data });
    await recordAuditEvent({
      actorId,
      action: "SETTINGS_CHANGED",
      entityType: "vehicle_type",
      entityId: created.id,
      after: {
        name: input.name,
        minKmPerLiter: input.minKmPerLiter,
        maxKmPerLiter: input.maxKmPerLiter,
      },
    });
    return { id: created.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A vehicle type with this name already exists.",
      });
    }
    throw error;
  }
}
