/**
 * Development seed — DEV/STAGING ONLY.
 *
 * Credentials created here are fixed, documented dev values (see README.md).
 * Production user provisioning happens through the admin UI (Phase 2) with
 * per-user strong passwords.
 *
 * Ledger invariant respected from the first row: initial tank stock is
 * created as a Delivery + DELIVERY stock_movement inside one transaction,
 * and tank.current_stock is set to that movement's balance_after — never
 * written as a bare value.
 *
 * Re-runnable: master data is upserted; initial-stock movements are only
 * created for tanks whose ledger is still empty.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, Role, FuelType, MeterType } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password";

const prisma = new PrismaClient();

async function seedCompanies() {
  const names = ["Macktiles", "Multilac", "Mandarina"] as const;
  const companies: Record<string, { id: string }> = {};
  for (const name of names) {
    companies[name] = await prisma.company.upsert({
      where: { name },
      update: {},
      create: { name },
      select: { id: true },
    });
  }
  return companies as Record<(typeof names)[number], { id: string }>;
}

async function seedSites(companyIds: { macktiles: string; multilac: string }) {
  const mainDepot = await prisma.site.upsert({
    where: { name: "Main Depot" },
    // Re-runs converge existing rows (e.g. migration's "Default Company")
    // onto the real group companies.
    update: { companyId: companyIds.macktiles },
    create: { name: "Main Depot", companyId: companyIds.macktiles },
  });
  const northYard = await prisma.site.upsert({
    where: { name: "North Yard" },
    update: { companyId: companyIds.multilac },
    create: { name: "North Yard", companyId: companyIds.multilac },
  });
  return { mainDepot, northYard };
}

/**
 * Quota settings singleton. Created DISABLED so seeding never turns
 * enforcement on; re-runs leave any admin-tuned configuration untouched.
 */
async function seedQuotaSettings() {
  await prisma.quotaSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

async function seedTanks(siteIds: { mainDepot: string; northYard: string }) {
  const tankA = await prisma.tank.upsert({
    where: { name: "Tank A" },
    update: {},
    create: {
      name: "Tank A",
      siteId: siteIds.mainDepot,
      fuelType: FuelType.DIESEL,
      capacityLiters: new Prisma.Decimal("5000"),
      lowStockThreshold: new Prisma.Decimal("1000"),
    },
  });
  const tankB = await prisma.tank.upsert({
    where: { name: "Tank B" },
    update: {},
    create: {
      name: "Tank B",
      siteId: siteIds.mainDepot,
      fuelType: FuelType.PETROL,
      capacityLiters: new Prisma.Decimal("3000"),
      lowStockThreshold: new Prisma.Decimal("600"),
    },
  });
  const tankC = await prisma.tank.upsert({
    where: { name: "Tank C" },
    update: {},
    create: {
      name: "Tank C",
      siteId: siteIds.northYard,
      fuelType: FuelType.DIESEL,
      capacityLiters: new Prisma.Decimal("8000"),
      lowStockThreshold: new Prisma.Decimal("1500"),
    },
  });
  return { tankA, tankB, tankC };
}

async function seedUsers(ids: { mainDepotId: string; tankAId: string; tankBId: string }) {
  // Fixed dev passwords, documented in README.md. All satisfy the strong
  // password policy in src/lib/validation.ts.
  const users: Array<{
    username: string;
    password: string;
    displayName: string;
    role: Role;
    siteId?: string;
    defaultTankId?: string;
  }> = [
    {
      username: "admin",
      password: "Admin#Fuel2026",
      displayName: "System Administrator",
      role: Role.ADMIN,
    },
    {
      username: "manager",
      password: "Manager#Fuel2026",
      displayName: "Kamal Jayasuriya",
      role: Role.MANAGER,
    },
    {
      username: "supervisor",
      password: "Supervisor#Fuel2026",
      displayName: "Sunil Bandara",
      role: Role.SUPERVISOR,
      siteId: ids.mainDepotId,
    },
    {
      username: "operator1",
      password: "Operator1#Fuel2026",
      displayName: "Nimal Perera",
      role: Role.OPERATOR,
      siteId: ids.mainDepotId,
      defaultTankId: ids.tankAId,
    },
    {
      username: "operator2",
      password: "Operator2#Fuel2026",
      displayName: "Ruwan Silva",
      role: Role.OPERATOR,
      siteId: ids.mainDepotId,
      defaultTankId: ids.tankBId,
    },
  ];

  const results: Record<string, { id: string }> = {};
  for (const user of users) {
    const passwordHash = await hashPassword(user.password);
    results[user.username] = await prisma.user.upsert({
      where: { username: user.username },
      // Keep existing password/lock state on re-run; only refresh assignment.
      update: {
        displayName: user.displayName,
        role: user.role,
        siteId: user.siteId ?? null,
        defaultTankId: user.defaultTankId ?? null,
      },
      create: {
        username: user.username,
        passwordHash,
        displayName: user.displayName,
        role: user.role,
        siteId: user.siteId ?? null,
        defaultTankId: user.defaultTankId ?? null,
      },
      select: { id: true },
    });
  }
  return results;
}

async function seedVehicleTypesAndVehicles(companyIds: {
  macktiles: string;
  multilac: string;
  mandarina: string;
}) {
  // Efficiency bands are in each type's own unit per litre:
  // DISTANCE km/L, HOURS hrs/L, ENERGY kWh/L.
  const types: Array<{ name: string; meterType: MeterType; min: string; max: string }> = [
    { name: "Bowser Truck", meterType: MeterType.DISTANCE, min: "2.00", max: "6.00" },
    { name: "Lorry", meterType: MeterType.DISTANCE, min: "3.00", max: "8.00" },
    { name: "Pickup", meterType: MeterType.DISTANCE, min: "6.00", max: "14.00" },
    { name: "Car", meterType: MeterType.DISTANCE, min: "8.00", max: "18.00" },
    { name: "Forklift", meterType: MeterType.HOURS, min: "0.80", max: "2.50" },
    { name: "Generator", meterType: MeterType.ENERGY, min: "2.50", max: "4.00" },
  ];
  const typeIds: Record<string, string> = {};
  for (const type of types) {
    const row = await prisma.vehicleType.upsert({
      where: { name: type.name },
      update: {
        meterType: type.meterType,
        minEfficiency: new Prisma.Decimal(type.min),
        maxEfficiency: new Prisma.Decimal(type.max),
      },
      create: {
        name: type.name,
        meterType: type.meterType,
        minEfficiency: new Prisma.Decimal(type.min),
        maxEfficiency: new Prisma.Decimal(type.max),
      },
      select: { id: true },
    });
    typeIds[type.name] = row.id;
  }

  // meter = the reading in the type's meter unit (km / hrs / kWh).
  const vehicles: Array<{
    plate: string;
    type: string;
    fuelType: FuelType;
    meter: number;
    companyId: string;
  }> = [
    {
      plate: "CAB-4587",
      type: "Bowser Truck",
      fuelType: FuelType.DIESEL,
      meter: 124_880,
      companyId: companyIds.multilac,
    },
    {
      plate: "NC-7712",
      type: "Lorry",
      fuelType: FuelType.DIESEL,
      meter: 88_450,
      companyId: companyIds.macktiles,
    },
    {
      plate: "PG-1204",
      type: "Pickup",
      fuelType: FuelType.PETROL,
      meter: 45_310,
      companyId: companyIds.macktiles,
    },
    {
      plate: "KV-9034",
      type: "Car",
      fuelType: FuelType.PETROL,
      meter: 61_204,
      companyId: companyIds.mandarina,
    },
    {
      plate: "FL-2201",
      type: "Forklift",
      fuelType: FuelType.DIESEL,
      meter: 3_420,
      companyId: companyIds.macktiles,
    },
    {
      plate: "GEN-01",
      type: "Generator",
      fuelType: FuelType.DIESEL,
      meter: 128_400,
      companyId: companyIds.multilac,
    },
  ];
  for (const vehicle of vehicles) {
    const typeId = typeIds[vehicle.type];
    if (!typeId) throw new Error(`Unknown vehicle type: ${vehicle.type}`);
    const row = await prisma.vehicle.upsert({
      where: { plateNumber: vehicle.plate },
      // Converge existing rows (migration's "Default Company") onto the
      // real owning companies on re-run.
      update: { companyId: vehicle.companyId },
      create: {
        plateNumber: vehicle.plate,
        vehicleTypeId: typeId,
        companyId: vehicle.companyId,
        fuelType: vehicle.fuelType,
        currentMeter: vehicle.meter,
      },
      select: { id: true },
    });

    // One active QR token per vehicle (opaque, random — never the plate).
    const activeToken = await prisma.qrToken.findFirst({
      where: { vehicleId: row.id, isActive: true },
    });
    if (!activeToken) {
      await prisma.qrToken.create({
        data: { token: `FT-${randomUUID()}`, vehicleId: row.id },
      });
    }
  }
}

async function seedDrivers() {
  const drivers = [
    { name: "Chaminda Fernando", employeeNo: "EMP-0142" },
    { name: "Ajith Kumara", employeeNo: "EMP-0187" },
  ];
  for (const driver of drivers) {
    await prisma.driver.upsert({
      where: { employeeNo: driver.employeeNo },
      update: {},
      create: driver,
    });
  }
}

/**
 * Initial stock as real ledger rows: Delivery header + DELIVERY movement +
 * current_stock cache update, all in ONE transaction per tank. Only runs for
 * tanks with an empty ledger, so re-seeding never corrupts balances.
 */
async function seedInitialStock(adminId: string, tanks: Array<{ id: string; liters: string }>) {
  for (const entry of tanks) {
    const existingMovements = await prisma.stockMovement.count({ where: { tankId: entry.id } });
    if (existingMovements > 0) continue;

    const liters = new Prisma.Decimal(entry.liters);
    await prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.create({
        data: {
          tankId: entry.id,
          receivedById: adminId,
          liters,
          supplierName: "Opening stock",
          referenceNo: "SEED-OPENING",
          deliveredAt: new Date(),
        },
      });
      await tx.stockMovement.create({
        data: {
          tankId: entry.id,
          type: "DELIVERY",
          quantity: liters,
          balanceAfter: liters,
          deliveryId: delivery.id,
          createdById: adminId,
        },
      });
      await tx.tank.update({
        where: { id: entry.id },
        data: { currentStock: liters },
      });
    });
  }
}

async function main() {
  const companies = await seedCompanies();
  const companyIds = {
    macktiles: companies.Macktiles.id,
    multilac: companies.Multilac.id,
    mandarina: companies.Mandarina.id,
  };
  const { mainDepot, northYard } = await seedSites(companyIds);
  const { tankA, tankB, tankC } = await seedTanks({
    mainDepot: mainDepot.id,
    northYard: northYard.id,
  });
  const users = await seedUsers({
    mainDepotId: mainDepot.id,
    tankAId: tankA.id,
    tankBId: tankB.id,
  });
  await seedVehicleTypesAndVehicles(companyIds);
  await seedDrivers();
  await seedQuotaSettings();

  const admin = users["admin"];
  if (!admin) throw new Error("Admin user was not seeded");
  await seedInitialStock(admin.id, [
    { id: tankA.id, liters: "2480.00" },
    { id: tankB.id, liters: "1850.00" },
    { id: tankC.id, liters: "5200.00" },
  ]);

  // eslint-disable-next-line no-console -- CLI script, not app runtime
  console.log(
    "Seed complete: 3 companies, 2 sites, 3 tanks, 5 users, 6 vehicle types, 6 vehicles.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
