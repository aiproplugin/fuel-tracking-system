import { db } from "@/server/db";
import { recordAuditEvent } from "@/server/services/audit.service";

/** List all sites with tank counts (used by forms and the tanks page). */
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

/** Create a site (ADMIN). Audited. */
export async function createSite(actorId: string, input: { name: string }) {
  const site = await db.site.create({ data: { name: input.name } });
  await recordAuditEvent({
    actorId,
    action: "SITE_CREATED",
    entityType: "site",
    entityId: site.id,
    after: { name: site.name },
  });
  return { id: site.id, name: site.name };
}
