import { Prisma, type MeterType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db";
import { recordAuditEvent } from "@/server/services/audit.service";

/**
 * Vehicle types with their meter type and abnormal-consumption bands
 * (Settings screen). Bands are in the type's own efficiency unit
 * (km/L, hrs/L, kWh/L).
 */
export async function listVehicleTypes() {
  const types = await db.vehicleType.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { vehicles: true } } },
  });
  return types.map((type) => ({
    id: type.id,
    name: type.name,
    meterType: type.meterType,
    minEfficiency: type.minEfficiency.toNumber(),
    maxEfficiency: type.maxEfficiency.toNumber(),
    defaultQuotaLiters: type.defaultQuotaLiters?.toNumber() ?? null,
    defaultQuotaPeriod: type.defaultQuotaPeriod,
    vehicleCount: type._count.vehicles,
  }));
}

/**
 * Create or update a vehicle type's meter type + efficiency band (ADMIN,
 * Settings). min < max is enforced by the input schema; changes are audited
 * as SETTINGS_CHANGED with before/after so band history is reconstructible.
 *
 * The meter type is editable only while no vehicle of the type has recorded
 * history (fuel transactions or pending meter exceptions): changing it after
 * that would silently reinterpret every stored reading and band, so the save
 * is rejected instead.
 */
export async function upsertVehicleType(
  actorId: string,
  input: {
    id?: string;
    name: string;
    meterType: MeterType;
    minEfficiency: number;
    maxEfficiency: number;
  },
) {
  const data = {
    name: input.name,
    meterType: input.meterType,
    minEfficiency: new Prisma.Decimal(input.minEfficiency),
    maxEfficiency: new Prisma.Decimal(input.maxEfficiency),
  };

  try {
    if (input.id) {
      const before = await db.vehicleType.findUnique({ where: { id: input.id } });
      if (!before) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle type not found." });
      }
      if (before.meterType !== input.meterType) {
        const historyCount = await db.fuelTransaction.count({
          where: { vehicle: { vehicleTypeId: input.id } },
        });
        const pendingExceptions = await db.meterException.count({
          where: { status: "PENDING", vehicle: { vehicleTypeId: input.id } },
        });
        if (historyCount > 0 || pendingExceptions > 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "The meter type cannot be changed once vehicles of this type have recorded fuel issues. Create a new vehicle type instead.",
          });
        }
      }
      const updated = await db.vehicleType.update({ where: { id: input.id }, data });
      await recordAuditEvent({
        actorId,
        action: "SETTINGS_CHANGED",
        entityType: "vehicle_type",
        entityId: updated.id,
        before: {
          name: before.name,
          meterType: before.meterType,
          minEfficiency: before.minEfficiency.toNumber(),
          maxEfficiency: before.maxEfficiency.toNumber(),
        },
        after: {
          name: input.name,
          meterType: input.meterType,
          minEfficiency: input.minEfficiency,
          maxEfficiency: input.maxEfficiency,
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
        meterType: input.meterType,
        minEfficiency: input.minEfficiency,
        maxEfficiency: input.maxEfficiency,
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
