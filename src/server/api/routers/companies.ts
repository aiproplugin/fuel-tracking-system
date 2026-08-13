import {
  createCompanySchema,
  deleteCompanySchema,
  updateCompanySchema,
} from "@/lib/schemas/company";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import {
  createCompany,
  deleteCompany,
  listCompanies,
  updateCompany,
} from "@/server/services/company.service";

export const companiesRouter = createTRPCRouter({
  list: permissionProcedure("masterdata.view").query(() => listCompanies()),
  create: permissionProcedure("masterdata.manage")
    .input(createCompanySchema)
    .mutation(({ ctx, input }) => createCompany(ctx.actor.id, input)),
  update: permissionProcedure("masterdata.manage")
    .input(updateCompanySchema)
    .mutation(({ ctx, input }) => updateCompany(ctx.actor.id, input)),
  delete: permissionProcedure("masterdata.manage")
    .input(deleteCompanySchema)
    .mutation(({ ctx, input }) => deleteCompany(ctx.actor.id, input)),
});
