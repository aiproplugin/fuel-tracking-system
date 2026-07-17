-- Company entity + fuel quota system.
--
-- DEV-DATA NOTE: the live database holds only disposable test data (wiped
-- before go-live). company_id is REQUIRED on site and vehicle from the start;
-- to let this migration apply on a non-empty dev database, a temporary
-- "Default Company" row is inserted (only when sites or vehicles exist) and
-- existing rows are attached to it. On a clean go-live database no such row
-- is created. There is deliberately NO data-preserving back-fill beyond that.

-- CreateEnum
CREATE TYPE "QuotaPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "QuotaMode" AS ENUM ('INHERIT', 'CUSTOM', 'EXEMPT');

-- CreateEnum
CREATE TYPE "QuotaEnforcementMode" AS ENUM ('OFF', 'WARN_OVERRIDE', 'HARD_BLOCK');

-- CreateEnum
CREATE TYPE "WeekStartDay" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'COMPANY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'COMPANY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'COMPANY_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'QUOTA_SETTINGS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'QUOTA_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'QUOTA_OVERRIDE_CODE_ISSUED';
ALTER TYPE "AuditAction" ADD VALUE 'QUOTA_OVERRIDE';
ALTER TYPE "AuditAction" ADD VALUE 'QUOTA_TOPUP';

-- CreateTable
CREATE TABLE "company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_quota_liters" DECIMAL(12,2),
    "default_quota_period" "QuotaPeriod",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_name_key" ON "company"("name");

-- Quota pair invariant: amount and period are set or cleared together.
ALTER TABLE "company" ADD CONSTRAINT "company_quota_pair_check"
    CHECK (("default_quota_liters" IS NULL) = ("default_quota_period" IS NULL));

-- Temporary default company for existing dev/test rows only (see note above).
INSERT INTO "company" ("id", "name", "created_at", "updated_at")
SELECT '00000000-0000-4000-8000-000000000001', 'Default Company', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "site") OR EXISTS (SELECT 1 FROM "vehicle");

-- AlterTable: site.company_id (required) — attach existing rows, then lock.
ALTER TABLE "site" ADD COLUMN "company_id" TEXT;
UPDATE "site" SET "company_id" = '00000000-0000-4000-8000-000000000001';
ALTER TABLE "site" ALTER COLUMN "company_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "site_company_id_idx" ON "site"("company_id");

-- AddForeignKey
ALTER TABLE "site" ADD CONSTRAINT "site_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: vehicle.company_id (required) + individual quota layer.
ALTER TABLE "vehicle" ADD COLUMN "company_id" TEXT;
UPDATE "vehicle" SET "company_id" = '00000000-0000-4000-8000-000000000001';
ALTER TABLE "vehicle" ALTER COLUMN "company_id" SET NOT NULL;

ALTER TABLE "vehicle" ADD COLUMN "quota_mode" "QuotaMode" NOT NULL DEFAULT 'INHERIT';
ALTER TABLE "vehicle" ADD COLUMN "custom_quota_liters" DECIMAL(12,2);
ALTER TABLE "vehicle" ADD COLUMN "custom_quota_period" "QuotaPeriod";
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_quota_pair_check"
    CHECK (("custom_quota_liters" IS NULL) = ("custom_quota_period" IS NULL));

-- CreateIndex
CREATE INDEX "vehicle_company_id_idx" ON "vehicle"("company_id");

-- AddForeignKey
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: vehicle-type quota default pair.
ALTER TABLE "vehicle_type" ADD COLUMN "default_quota_liters" DECIMAL(12,2);
ALTER TABLE "vehicle_type" ADD COLUMN "default_quota_period" "QuotaPeriod";
ALTER TABLE "vehicle_type" ADD CONSTRAINT "vehicle_type_quota_pair_check"
    CHECK (("default_quota_liters" IS NULL) = ("default_quota_period" IS NULL));

-- AlterTable: quota override stamp on fuel transactions.
ALTER TABLE "fuel_transaction" ADD COLUMN "quota_override" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "fuel_transaction" ADD COLUMN "quota_override_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "fuel_transaction" ADD CONSTRAINT "fuel_transaction_quota_override_by_id_fkey" FOREIGN KEY ("quota_override_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "quota_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enforcement_enabled" BOOLEAN NOT NULL DEFAULT false,
    "enforcement_mode" "QuotaEnforcementMode" NOT NULL DEFAULT 'WARN_OVERRIDE',
    "warning_threshold_pct" INTEGER NOT NULL DEFAULT 80,
    "week_start_day" "WeekStartDay" NOT NULL DEFAULT 'MONDAY',
    "global_quota_liters" DECIMAL(12,2),
    "global_quota_period" "QuotaPeriod",
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quota_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "quota_settings" ADD CONSTRAINT "quota_settings_quota_pair_check"
    CHECK (("global_quota_liters" IS NULL) = ("global_quota_period" IS NULL));

-- CreateTable
CREATE TABLE "quota_top_up" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "liters" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "granted_by_id" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "window_end" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quota_top_up_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quota_top_up_vehicle_id_window_start_idx" ON "quota_top_up"("vehicle_id", "window_start");

-- AddForeignKey
ALTER TABLE "quota_top_up" ADD CONSTRAINT "quota_top_up_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_top_up" ADD CONSTRAINT "quota_top_up_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "quota_override_code" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "issued_by_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "used_in_transaction_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quota_override_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quota_override_code_used_in_transaction_id_key" ON "quota_override_code"("used_in_transaction_id");

-- CreateIndex
CREATE INDEX "quota_override_code_vehicle_id_expires_at_idx" ON "quota_override_code"("vehicle_id", "expires_at");

-- AddForeignKey
ALTER TABLE "quota_override_code" ADD CONSTRAINT "quota_override_code_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_override_code" ADD CONSTRAINT "quota_override_code_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
