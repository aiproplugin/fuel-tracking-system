import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { type FuelTypeName } from "@/lib/fuel";
import { db } from "@/server/db";
import { type Actor } from "@/server/services/actor";
import { recordAuditEvent } from "@/server/services/audit.service";

/**
 * Vehicle list. Vehicles are fleet-wide (not site-bound), so all admin
 * roles see the full list; the actor is accepted for future scoping and
 * consistency with the other list services.
 */
export async function listVehicles(_actor: Actor) {
  const vehicles = await db.vehicle.findMany({
    orderBy: { plateNumber: "asc" },
    include: {
      vehicleType: { select: { id: true, name: true, meterType: true } },
      company: { select: { id: true, name: true } },
      qrTokens: { where: { isActive: true }, select: { id: true }, take: 1 },
    },
  });
  return vehicles.map((vehicle) => ({
    id: vehicle.id,
    plateNumber: vehicle.plateNumber,
    vehicleType: vehicle.vehicleType,
    meterType: vehicle.vehicleType.meterType,
    company: vehicle.company,
    fuelType: vehicle.fuelType,
    currentMeter: vehicle.currentMeter,
    quotaMode: vehicle.quotaMode,
    isActive: vehicle.isActive,
    hasActiveQrToken: vehicle.qrTokens.length > 0,
  }));
}

function mapVehicleWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A vehicle with this plate number already exists.",
      });
    }
    if (error.code === "P2003") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Selected company or vehicle type does not exist.",
      });
    }
  }
  throw error;
}

/** Create a vehicle (ADMIN). Every vehicle belongs to a company. Audited. */
export async function createVehicle(
  actorId: string,
  input: {
    plateNumber: string;
    vehicleTypeId: string;
    companyId: string;
    fuelType: FuelTypeName;
    currentMeter: number;
  },
) {
  try {
    const vehicle = await db.vehicle.create({ data: input });
    await recordAuditEvent({
      actorId,
      action: "VEHICLE_CREATED",
      entityType: "vehicle",
      entityId: vehicle.id,
      after: {
        plateNumber: input.plateNumber,
        fuelType: input.fuelType,
        companyId: input.companyId,
      },
    });
    return { id: vehicle.id };
  } catch (error) {
    mapVehicleWriteError(error);
  }
}

/**
 * Update a vehicle (ADMIN). The meter reading is deliberately NOT editable
 * here — it only moves through fuel transactions and the ADMIN
 * exception-review flow (Phase 3), so the reading always has an audited
 * origin. The quota mode/pair is likewise managed only via the quota
 * service (QUOTA_ASSIGNED).
 */
export async function updateVehicle(
  actorId: string,
  input: {
    id: string;
    plateNumber: string;
    vehicleTypeId: string;
    companyId: string;
    fuelType: FuelTypeName;
    isActive: boolean;
  },
) {
  const before = await db.vehicle.findUnique({ where: { id: input.id } });
  if (!before) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle not found." });
  }

  try {
    await db.vehicle.update({
      where: { id: input.id },
      data: {
        plateNumber: input.plateNumber,
        vehicleTypeId: input.vehicleTypeId,
        companyId: input.companyId,
        fuelType: input.fuelType,
        isActive: input.isActive,
      },
    });
  } catch (error) {
    mapVehicleWriteError(error);
  }

  await recordAuditEvent({
    actorId,
    action: "VEHICLE_UPDATED",
    entityType: "vehicle",
    entityId: input.id,
    before: {
      plateNumber: before.plateNumber,
      fuelType: before.fuelType,
      companyId: before.companyId,
      isActive: before.isActive,
    },
    after: {
      plateNumber: input.plateNumber,
      fuelType: input.fuelType,
      companyId: input.companyId,
      isActive: input.isActive,
    },
  });
}
