import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db";
import { recordAuditEvent } from "@/server/services/audit.service";

/**
 * Group-company CRUD. Companies own sites and vehicles; the quota default
 * pair on a company is managed through the quota service (QUOTA_ASSIGNED),
 * never here — this service only handles identity and lifecycle.
 */

/** List all companies with site/vehicle counts and their quota default pair. */
export async function listCompanies() {
  const companies = await db.company.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { sites: true, vehicles: true } } },
  });
  return companies.map((company) => ({
    id: company.id,
    name: company.name,
    siteCount: company._count.sites,
    vehicleCount: company._count.vehicles,
    defaultQuotaLiters: company.defaultQuotaLiters?.toNumber() ?? null,
    defaultQuotaPeriod: company.defaultQuotaPeriod,
  }));
}

/** Create a company (ADMIN). Audited. Duplicate name -> friendly CONFLICT. */
export async function createCompany(actorId: string, input: { name: string }) {
  try {
    const company = await db.company.create({ data: { name: input.name } });
    await recordAuditEvent({
      actorId,
      action: "COMPANY_CREATED",
      entityType: "company",
      entityId: company.id,
      after: { name: company.name },
    });
    return { id: company.id, name: company.name };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new TRPCError({ code: "CONFLICT", message: "A company with this name already exists." });
    }
    throw error;
  }
}

/** Rename a company (ADMIN). Audited with before/after. Duplicate name -> CONFLICT. */
export async function updateCompany(actorId: string, input: { id: string; name: string }) {
  const before = await db.company.findUnique({ where: { id: input.id } });
  if (!before) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Company not found." });
  }

  try {
    await db.company.update({ where: { id: input.id }, data: { name: input.name } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new TRPCError({ code: "CONFLICT", message: "A company with this name already exists." });
    }
    throw error;
  }

  await recordAuditEvent({
    actorId,
    action: "COMPANY_UPDATED",
    entityType: "company",
    entityId: input.id,
    before: { name: before.name },
    after: { name: input.name },
  });
}

/**
 * Delete a company (ADMIN). Delete-when-empty only: both FKs are ON DELETE
 * RESTRICT, so a company with attached sites or vehicles is blocked with a
 * friendly message instead of a raw DB error. Audited as COMPANY_DELETED.
 */
export async function deleteCompany(actorId: string, input: { id: string }) {
  const company = await db.company.findUnique({
    where: { id: input.id },
    include: { _count: { select: { sites: true, vehicles: true } } },
  });
  if (!company) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Company not found." });
  }

  if (company._count.sites > 0 || company._count.vehicles > 0) {
    const parts: string[] = [];
    if (company._count.sites > 0) {
      parts.push(`${company._count.sites} site${company._count.sites === 1 ? "" : "s"}`);
    }
    if (company._count.vehicles > 0) {
      parts.push(`${company._count.vehicles} vehicle${company._count.vehicles === 1 ? "" : "s"}`);
    }
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Cannot delete this company: ${parts.join(" and ")} still attached. Reassign or remove them first.`,
    });
  }

  try {
    await db.company.delete({ where: { id: input.id } });
  } catch (error) {
    // Safety net: a reference that slipped in between the count and the
    // delete surfaces the same friendly message instead of a raw FK error.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Cannot delete this company while sites or vehicles are still attached.",
      });
    }
    throw error;
  }

  await recordAuditEvent({
    actorId,
    action: "COMPANY_DELETED",
    entityType: "company",
    entityId: input.id,
    before: { name: company.name },
  });
}
