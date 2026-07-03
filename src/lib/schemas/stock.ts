import { z } from "zod";
import { strictObject } from "@/lib/validation";
import { idSchema } from "@/lib/schemas/master-data";

/**
 * Delivery + adjustment input schemas (strict). Deliveries are SUPERVISOR
 * (own site) / ADMIN only — there is deliberately NO operator variant:
 * deliveries increase stock and carry a higher control risk than issues
 * (see docs/security.md).
 */

export const MAX_DELIVERY_LITERS = 100_000;
export const MAX_ADJUSTMENT_LITERS = 100_000;
/** Backdating window for deliveries (paper records catching up). */
export const MAX_BACKDATE_DAYS = 31;

const deliveredAtSchema = z.coerce
  .date()
  .refine((value) => value.getTime() <= Date.now() + 60_000, {
    message: "Delivery time cannot be in the future",
  })
  .refine((value) => value.getTime() >= Date.now() - MAX_BACKDATE_DAYS * 24 * 3_600_000, {
    message: `Delivery time cannot be more than ${MAX_BACKDATE_DAYS} days ago`,
  });

export const createDeliverySchema = strictObject({
  tankId: idSchema,
  idempotencyKey: idSchema,
  liters: z.number().positive("Liters must be positive").max(MAX_DELIVERY_LITERS),
  supplierName: z.string().trim().min(2).max(120).optional(),
  referenceNo: z.string().trim().min(1).max(60).optional(),
  deliveredAt: deliveredAtSchema,
});

export const createAdjustmentSchema = strictObject({
  tankId: idSchema,
  idempotencyKey: idSchema,
  /** Signed liters: negative = shrinkage/correction down, positive = up. */
  quantityChange: z
    .number()
    .max(MAX_ADJUSTMENT_LITERS)
    .min(-MAX_ADJUSTMENT_LITERS)
    .refine((value) => value !== 0, { message: "Adjustment cannot be zero" }),
  reason: z.string().trim().min(5, "A reason is required (min 5 characters)").max(500),
});

export const stockListSchema = strictObject({
  cursor: idSchema.nullish(),
  limit: z.number().int().min(1).max(100).default(20),
  // Injected by tRPC's useInfiniteQuery transport; ignored by services.
  direction: z.enum(["forward", "backward"]).optional(),
});
