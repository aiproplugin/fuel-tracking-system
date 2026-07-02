import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import QRCode from "qrcode";
import { db } from "@/server/db";
import { recordAuditEvent } from "@/server/services/audit.service";

/**
 * QR token lifecycle. Tokens are opaque (`FT-<uuid>`) and live only in
 * qr_token — never the plate, never a column on vehicle. Rotation
 * deactivates the old row and inserts a new one; vehicle history is
 * untouched. At most ONE active token per vehicle.
 */

export function generateOpaqueToken(): string {
  return `FT-${randomUUID()}`;
}

/** Vehicles with their token status (QR Tokens admin page). */
export async function listVehicleTokens() {
  const vehicles = await db.vehicle.findMany({
    orderBy: { plateNumber: "asc" },
    include: {
      qrTokens: {
        orderBy: { createdAt: "desc" },
        select: { id: true, isActive: true, createdAt: true, deactivatedAt: true },
      },
    },
  });
  return vehicles.map((vehicle) => {
    const activeToken = vehicle.qrTokens.find((token) => token.isActive) ?? null;
    return {
      vehicleId: vehicle.id,
      plateNumber: vehicle.plateNumber,
      fuelType: vehicle.fuelType,
      vehicleIsActive: vehicle.isActive,
      activeToken: activeToken ? { id: activeToken.id, createdAt: activeToken.createdAt } : null,
      totalIssued: vehicle.qrTokens.length,
    };
  });
}

/** Issue the FIRST token for a vehicle (fails if one is already active). */
export async function createTokenForVehicle(actorId: string, input: { vehicleId: string }) {
  const vehicle = await db.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle not found." });
  }
  const existing = await db.qrToken.findFirst({
    where: { vehicleId: input.vehicleId, isActive: true },
  });
  if (existing) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "An active token already exists — rotate it instead.",
    });
  }
  const token = await db.qrToken.create({
    data: { token: generateOpaqueToken(), vehicleId: input.vehicleId },
  });
  await recordAuditEvent({
    actorId,
    action: "QR_TOKEN_CREATED",
    entityType: "qr_token",
    entityId: token.id,
    after: { vehicleId: input.vehicleId },
  });
  return { tokenId: token.id };
}

/**
 * Rotate: atomically deactivate every active token for the vehicle and
 * issue a fresh one. The old QR sheet stops working immediately.
 */
export async function rotateToken(actorId: string, input: { vehicleId: string }) {
  const vehicle = await db.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle not found." });
  }

  const newToken = await db.$transaction(async (tx) => {
    await tx.qrToken.updateMany({
      where: { vehicleId: input.vehicleId, isActive: true },
      data: { isActive: false, deactivatedAt: new Date() },
    });
    return tx.qrToken.create({
      data: { token: generateOpaqueToken(), vehicleId: input.vehicleId },
    });
  });

  await recordAuditEvent({
    actorId,
    action: "QR_TOKEN_ROTATED",
    entityType: "qr_token",
    entityId: newToken.id,
    after: { vehicleId: input.vehicleId },
  });
  return { tokenId: newToken.id };
}

/** Deactivate a specific token without issuing a replacement. */
export async function deactivateToken(actorId: string, input: { tokenId: string }) {
  const token = await db.qrToken.findUnique({ where: { id: input.tokenId } });
  if (!token || !token.isActive) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Active token not found." });
  }
  await db.qrToken.update({
    where: { id: input.tokenId },
    data: { isActive: false, deactivatedAt: new Date() },
  });
  await recordAuditEvent({
    actorId,
    action: "QR_TOKEN_DEACTIVATED",
    entityType: "qr_token",
    entityId: input.tokenId,
    after: { vehicleId: token.vehicleId },
  });
}

/**
 * Print-sheet data: plate + QR image (PNG data URL) for the ACTIVE token.
 * The QR encodes only the opaque token string.
 */
export async function getPrintData(input: { vehicleId: string }) {
  const vehicle = await db.vehicle.findUnique({
    where: { id: input.vehicleId },
    include: {
      qrTokens: { where: { isActive: true }, take: 1 },
      vehicleType: { select: { name: true } },
    },
  });
  if (!vehicle) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle not found." });
  }
  const activeToken = vehicle.qrTokens[0];
  if (!activeToken) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This vehicle has no active QR token.",
    });
  }

  const qrDataUrl = await QRCode.toDataURL(activeToken.token, {
    width: 512,
    margin: 1,
    errorCorrectionLevel: "M",
  });

  return {
    plateNumber: vehicle.plateNumber,
    vehicleTypeName: vehicle.vehicleType.name,
    fuelType: vehicle.fuelType,
    tokenCreatedAt: activeToken.createdAt,
    qrDataUrl,
  };
}
