import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db";
import { recordAuditEvent } from "@/server/services/audit.service";

/** List all sites with tank/user counts (used by forms and the sites page). */
export async function listSites() {
  const sites = await db.site.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { tanks: true, users: true } } },
  });
  return sites.map((site) => ({
    id: site.id,
    name: site.name,
    tankCount: site._count.tanks,
    userCount: site._count.users,
  }));
}

/** Create a site (ADMIN). Audited. Duplicate name -> friendly CONFLICT. */
export async function createSite(actorId: string, input: { name: string }) {
  try {
    const site = await db.site.create({ data: { name: input.name } });
    await recordAuditEvent({
      actorId,
      action: "SITE_CREATED",
      entityType: "site",
      entityId: site.id,
      after: { name: site.name },
    });
    return { id: site.id, name: site.name };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new TRPCError({ code: "CONFLICT", message: "A site with this name already exists." });
    }
    throw error;
  }
}

/** Rename a site (ADMIN). Audited with before/after. Duplicate name -> CONFLICT. */
export async function updateSite(actorId: string, input: { id: string; name: string }) {
  const before = await db.site.findUnique({ where: { id: input.id } });
  if (!before) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Site not found." });
  }

  try {
    await db.site.update({ where: { id: input.id }, data: { name: input.name } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new TRPCError({ code: "CONFLICT", message: "A site with this name already exists." });
    }
    throw error;
  }

  await recordAuditEvent({
    actorId,
    action: "SITE_UPDATED",
    entityType: "site",
    entityId: input.id,
    before: { name: before.name },
    after: { name: input.name },
  });
}

/**
 * Delete a site (ADMIN). Only safe when nothing references it: the tank FK is
 * ON DELETE RESTRICT and users carry a site_id, so a site with attached tanks
 * or users is blocked with a friendly "detach first" message rather than a raw
 * DB foreign-key error. Audited as SITE_DELETED.
 */
export async function deleteSite(actorId: string, input: { id: string }) {
  const site = await db.site.findUnique({
    where: { id: input.id },
    include: { _count: { select: { tanks: true, users: true } } },
  });
  if (!site) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Site not found." });
  }

  if (site._count.tanks > 0 || site._count.users > 0) {
    const parts: string[] = [];
    if (site._count.tanks > 0) {
      parts.push(`${site._count.tanks} tank${site._count.tanks === 1 ? "" : "s"}`);
    }
    if (site._count.users > 0) {
      parts.push(`${site._count.users} user${site._count.users === 1 ? "" : "s"}`);
    }
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Cannot delete this site: ${parts.join(" and ")} still attached. Reassign or remove them first.`,
    });
  }

  try {
    await db.site.delete({ where: { id: input.id } });
  } catch (error) {
    // Safety net: if a reference slipped in between the count and the delete,
    // surface the same friendly message instead of a raw FK (P2003) error.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Cannot delete this site while tanks or users are still attached.",
      });
    }
    throw error;
  }

  await recordAuditEvent({
    actorId,
    action: "SITE_DELETED",
    entityType: "site",
    entityId: input.id,
    before: { name: site.name },
  });
}
