import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
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
      vehicleType: { select: { id: true, name: true } },
      qrTokens: { where: { isActive: true }, select: { id: true }, take: 1 },
    },
  });
  return vehicles.map((vehicle) => ({
    id: vehicle.id,
    plateNumber: vehicle.plateNumber,
    vehicleType: vehicle.vehicleType,
    fuelType: vehicle.fuelType,
    currentOdometer: vehicle.currentOdometer,
    isActive: vehicle.isActive,
    hasActiveQrToken: vehicle.qrTokens.length > 0,
  }));
}

/** Create a vehicle (ADMIN). Unique plate enforced; audited. */
export async function createVehicle(
  actorId: string,
  input: {
    plateNumber: string;
    vehicleTypeId: string;
    fuelType: "PETROL" | "DIESEL";
    currentOdometer: number;
  },
) {
  try {
    const vehicle = await db.vehicle.create({ data: input });
    await recordAuditEvent({
      actorId,
      action: "VEHICLE_CREATED",
      entityType: "vehicle",
      entityId: vehicle.id,
      after: { plateNumber: input.plateNumber, fuelType: input.fuelType },
    });
    return { id: vehicle.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A vehicle with this plate number already exists.",
      });
    }
    throw error;
  }
}

/**
 * Update a vehicle (ADMIN). Odometer is deliberately NOT editable here —
 * it only moves through fuel transactions and the ADMIN exception-review
 * flow (Phase 3), so the reading always has an audited origin.
 */
export async function updateVehicle(
  actorId: string,
  input: {
    id: string;
    plateNumber: string;
    vehicleTypeId: string;
    fuelType: "PETROL" | "DIESEL";
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
        fuelType: input.fuelType,
        isActive: input.isActive,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A vehicle with this plate number already exists.",
      });
    }
    throw error;
  }

  await recordAuditEvent({
    actorId,
    action: "VEHICLE_UPDATED",
    entityType: "vehicle",
    entityId: input.id,
    before: {
      plateNumber: before.plateNumber,
      fuelType: before.fuelType,
      isActive: before.isActive,
    },
    after: {
      plateNumber: input.plateNumber,
      fuelType: input.fuelType,
      isActive: input.isActive,
    },
  });
}
