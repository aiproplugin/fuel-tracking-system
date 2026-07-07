import {
  createSiteSchema,
  deleteSiteSchema,
  updateSiteSchema,
} from "@/lib/schemas/master-data";
import { adminProcedure, createTRPCRouter, supervisorProcedure } from "@/server/api/trpc";
import {
  createSite,
  deleteSite,
  listSites,
  updateSite,
} from "@/server/services/site.service";

export const sitesRouter = createTRPCRouter({
  /** Supervisor+ may read the site list (also feeds tank/user form dropdowns). */
  list: supervisorProcedure.query(() => listSites()),
  create: adminProcedure
    .input(createSiteSchema)
    .mutation(({ ctx, input }) => createSite(ctx.session.user.id, input)),
  update: adminProcedure
    .input(updateSiteSchema)
    .mutation(({ ctx, input }) => updateSite(ctx.session.user.id, input)),
  delete: adminProcedure
    .input(deleteSiteSchema)
    .mutation(({ ctx, input }) => deleteSite(ctx.session.user.id, input)),
});
