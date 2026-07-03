-- Idempotency keys for deliveries and adjustments (nullable: earlier rows
-- predate the feature). Unique enforces single-record-per-submission.
ALTER TABLE "delivery" ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "delivery_idempotency_key_key" ON "delivery"("idempotency_key");

ALTER TABLE "stock_adjustment" ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "stock_adjustment_idempotency_key_key" ON "stock_adjustment"("idempotency_key");
