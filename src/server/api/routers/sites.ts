import { createSiteSchema, deleteSiteSchema, updateSiteSchema } from "@/lib/schemas/master-data";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import { createSite, deleteSite, listSites, updateSite } from "@/server/services/site.service";

export const sitesRouter = createTRPCRouter({
  /** Also feeds tank/user form dropdowns, hence the read-level permission. */
  list: permissionProcedure("masterdata.view").query(() => listSites()),
  create: permissionProcedure("masterdata.manage")
    .input(createSiteSchema)
    .mutation(({ ctx, input }) => createSite(ctx.actor.id, input)),
  update: permissionProcedure("masterdata.manage")
    .input(updateSiteSchema)
    .mutation(({ ctx, input }) => updateSite(ctx.actor.id, input)),
  delete: permissionProcedure("masterdata.manage")
    .input(deleteSiteSchema)
    .mutation(({ ctx, input }) => deleteSite(ctx.actor.id, input)),
});
