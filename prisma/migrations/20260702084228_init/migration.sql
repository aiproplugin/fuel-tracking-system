-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OPERATOR', 'SUPERVISOR', 'MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('PETROL', 'DIESEL');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ISSUE', 'DELIVERY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGIN_RATE_LIMITED', 'ACCOUNT_LOCKED', 'LOGOUT', 'USER_CREATED', 'USER_UPDATED', 'ROLE_CHANGED', 'TANK_ASSIGNED', 'ODOMETER_OVERRIDE', 'ODOMETER_EXCEPTION_FLAGGED', 'ODOMETER_EXCEPTION_REVIEWED', 'FUEL_ISSUED', 'DELIVERY_RECORDED', 'ADJUSTMENT_RECORDED', 'QR_TOKEN_CREATED', 'QR_TOKEN_ROTATED', 'QR_TOKEN_DEACTIVATED', 'SETTINGS_CHANGED');

-- CreateTable
CREATE TABLE "site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "default_tank_id" TEXT,
    "site_id" TEXT,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employee_no" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tank" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "fuel_type" "FuelType" NOT NULL,
    "capacity_liters" DECIMAL(12,2) NOT NULL,
    "current_stock" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "low_stock_threshold" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_type" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "min_km_per_liter" DECIMAL(6,2) NOT NULL,
    "max_km_per_liter" DECIMAL(6,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicle_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle" (
    "id" TEXT NOT NULL,
    "plate_number" TEXT NOT NULL,
    "vehicle_type_id" TEXT NOT NULL,
    "fuel_type" "FuelType" NOT NULL,
    "current_odometer" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_token" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at" TIMESTAMPTZ(3),

    CONSTRAINT "qr_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_transaction" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "tank_id" TEXT NOT NULL,
    "operator_id" TEXT NOT NULL,
    "driver_id" TEXT,
    "liters" DECIMAL(10,2) NOT NULL,
    "odometer" INTEGER NOT NULL,
    "previous_odometer" INTEGER NOT NULL,
    "odometer_override" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" TEXT,
    "override_by_user_id" TEXT,
    "km_per_liter" DECIMAL(6,2),
    "is_abnormal" BOOLEAN NOT NULL DEFAULT false,
    "unit_cost" DECIMAL(10,2),
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery" (
    "id" TEXT NOT NULL,
    "tank_id" TEXT NOT NULL,
    "received_by_id" TEXT NOT NULL,
    "liters" DECIMAL(12,2) NOT NULL,
    "supplier_name" TEXT,
    "reference_no" TEXT,
    "unit_cost" DECIMAL(10,2),
    "delivered_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment" (
    "id" TEXT NOT NULL,
    "tank_id" TEXT NOT NULL,
    "adjusted_by_id" TEXT NOT NULL,
    "quantity_change" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "adjusted_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" BIGSERIAL NOT NULL,
    "tank_id" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "fuel_transaction_id" TEXT,
    "delivery_id" TEXT,
    "adjustment_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "odometer_exception" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "tank_id" TEXT NOT NULL,
    "operator_id" TEXT NOT NULL,
    "previous_odometer" INTEGER NOT NULL,
    "attempted_odometer" INTEGER NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'PENDING',
    "corrected_odometer" INTEGER,
    "review_reason" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "odometer_exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" TEXT,
    "action" "AuditAction" NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_name_key" ON "site"("name");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_username_key" ON "app_user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "driver_employee_no_key" ON "driver"("employee_no");

-- CreateIndex
CREATE UNIQUE INDEX "tank_name_key" ON "tank"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_type_name_key" ON "vehicle_type"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_plate_number_key" ON "vehicle"("plate_number");

-- CreateIndex
CREATE UNIQUE INDEX "qr_token_token_key" ON "qr_token"("token");

-- CreateIndex
CREATE INDEX "qr_token_vehicle_id_idx" ON "qr_token"("vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_transaction_idempotency_key_key" ON "fuel_transaction"("idempotency_key");

-- CreateIndex
CREATE INDEX "fuel_transaction_vehicle_id_issued_at_idx" ON "fuel_transaction"("vehicle_id", "issued_at");

-- CreateIndex
CREATE INDEX "fuel_transaction_tank_id_issued_at_idx" ON "fuel_transaction"("tank_id", "issued_at");

-- CreateIndex
CREATE INDEX "delivery_tank_id_delivered_at_idx" ON "delivery"("tank_id", "delivered_at");

-- CreateIndex
CREATE INDEX "stock_adjustment_tank_id_adjusted_at_idx" ON "stock_adjustment"("tank_id", "adjusted_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_fuel_transaction_id_key" ON "stock_movement"("fuel_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_delivery_id_key" ON "stock_movement"("delivery_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_adjustment_id_key" ON "stock_movement"("adjustment_id");

-- CreateIndex
CREATE INDEX "stock_movement_tank_id_id_idx" ON "stock_movement"("tank_id", "id");

-- CreateIndex
CREATE INDEX "odometer_exception_status_created_at_idx" ON "odometer_exception"("status", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_action_created_at_idx" ON "audit_log"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_default_tank_id_fkey" FOREIGN KEY ("default_tank_id") REFERENCES "tank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank" ADD CONSTRAINT "tank_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_token" ADD CONSTRAINT "qr_token_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transaction" ADD CONSTRAINT "fuel_transaction_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transaction" ADD CONSTRAINT "fuel_transaction_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "tank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transaction" ADD CONSTRAINT "fuel_transaction_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transaction" ADD CONSTRAINT "fuel_transaction_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transaction" ADD CONSTRAINT "fuel_transaction_override_by_user_id_fkey" FOREIGN KEY ("override_by_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "tank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "tank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_adjusted_by_id_fkey" FOREIGN KEY ("adjusted_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "tank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_fuel_transaction_id_fkey" FOREIGN KEY ("fuel_transaction_id") REFERENCES "fuel_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "stock_adjustment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odometer_exception" ADD CONSTRAINT "odometer_exception_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odometer_exception" ADD CONSTRAINT "odometer_exception_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "tank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odometer_exception" ADD CONSTRAINT "odometer_exception_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odometer_exception" ADD CONSTRAINT "odometer_exception_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
