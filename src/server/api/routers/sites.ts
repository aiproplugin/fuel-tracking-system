import { createSiteSchema } from "@/lib/schemas/master-data";
import { adminProcedure, createTRPCRouter, supervisorProcedure } from "@/server/api/trpc";
import { createSite, listSites } from "@/server/services/site.service";

export const sitesRouter = createTRPCRouter({
  list: supervisorProcedure.query(() => listSites()),
  create: adminProcedure
    .input(createSiteSchema)
    .mutation(({ ctx, input }) => createSite(ctx.session.user.id, input)),
});
