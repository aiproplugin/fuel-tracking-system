import {
  createCompanySchema,
  deleteCompanySchema,
  updateCompanySchema,
} from "@/lib/schemas/company";
import { adminProcedure, createTRPCRouter, supervisorProcedure } from "@/server/api/trpc";
import {
  createCompany,
  deleteCompany,
  listCompanies,
  updateCompany,
} from "@/server/services/company.service";

export const companiesRouter = createTRPCRouter({
  list: supervisorProcedure.query(() => listCompanies()),
  create: adminProcedure
    .input(createCompanySchema)
    .mutation(({ ctx, input }) => createCompany(ctx.session.user.id, input)),
  update: adminProcedure
    .input(updateCompanySchema)
    .mutation(({ ctx, input }) => updateCompany(ctx.session.user.id, input)),
  delete: adminProcedure
    .input(deleteCompanySchema)
    .mutation(({ ctx, input }) => deleteCompany(ctx.session.user.id, input)),
});
