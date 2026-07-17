-- Generalise the vehicle usage meter: odometer (km-only) -> meter (per
-- vehicle-type MeterType: DISTANCE km, HOURS hrs, ENERGY kWh). Efficiency is
-- always meter-delta per litre (km/L, hrs/L, kWh/L) — one engine, the type
-- only changes units/labels.
--
-- DEV-DATA NOTE: the live database holds only disposable test data (wiped
-- before go-live), so this is a clean rename migration. Existing readings are
-- kept via RENAME COLUMN (all existing vehicle types default to DISTANCE, so
-- their km readings stay meaningful). The odometer_exception table is dropped
-- and recreated as meter_exception so its constraint/index names stay
-- Prisma-canonical; pending dev exceptions are discarded.

-- CreateEnum
CREATE TYPE "MeterType" AS ENUM ('DISTANCE', 'HOURS', 'ENERGY');

-- AlterEnum: rename the odometer audit actions in place — existing audit_log
-- rows keep their history under the new names (append-only trail preserved).
ALTER TYPE "AuditAction" RENAME VALUE 'ODOMETER_OVERRIDE' TO 'METER_OVERRIDE';
ALTER TYPE "AuditAction" RENAME VALUE 'ODOMETER_EXCEPTION_FLAGGED' TO 'METER_EXCEPTION_FLAGGED';
ALTER TYPE "AuditAction" RENAME VALUE 'ODOMETER_EXCEPTION_REVIEWED' TO 'METER_EXCEPTION_REVIEWED';

-- AlterTable: vehicle_type — meter type + efficiency band rename.
ALTER TABLE "vehicle_type" ADD COLUMN "meter_type" "MeterType" NOT NULL DEFAULT 'DISTANCE';
ALTER TABLE "vehicle_type" RENAME COLUMN "min_km_per_liter" TO "min_efficiency";
ALTER TABLE "vehicle_type" RENAME COLUMN "max_km_per_liter" TO "max_efficiency";

-- Band invariant (mirrors the Zod schema): positive min strictly below max.
ALTER TABLE "vehicle_type" ADD CONSTRAINT "vehicle_type_efficiency_band_check"
    CHECK ("min_efficiency" > 0 AND "min_efficiency" < "max_efficiency");

-- AlterTable: vehicle — cached highest accepted reading.
ALTER TABLE "vehicle" RENAME COLUMN "current_odometer" TO "current_meter";

-- AlterTable: fuel_transaction — reading pair, override flag, efficiency.
ALTER TABLE "fuel_transaction" RENAME COLUMN "odometer" TO "meter_reading";
ALTER TABLE "fuel_transaction" RENAME COLUMN "previous_odometer" TO "previous_meter_reading";
ALTER TABLE "fuel_transaction" RENAME COLUMN "odometer_override" TO "meter_override";
ALTER TABLE "fuel_transaction" RENAME COLUMN "km_per_liter" TO "efficiency";

-- DropTable: odometer_exception (disposable dev data; recreated below with
-- Prisma-canonical names as meter_exception).
DROP TABLE "odometer_exception";

-- CreateTable
CREATE TABLE "meter_exception" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "tank_id" TEXT NOT NULL,
    "operator_id" TEXT NOT NULL,
    "liters" DECIMAL(10,2) NOT NULL,
    "previous_reading" INTEGER NOT NULL,
    "attempted_reading" INTEGER NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'PENDING',
    "corrected_reading" INTEGER,
    "review_reason" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_exception_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meter_exception_status_created_at_idx" ON "meter_exception"("status", "created_at");

-- AddForeignKey
ALTER TABLE "meter_exception" ADD CONSTRAINT "meter_exception_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_exception" ADD CONSTRAINT "meter_exception_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "tank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_exception" ADD CONSTRAINT "meter_exception_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_exception" ADD CONSTRAINT "meter_exception_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
