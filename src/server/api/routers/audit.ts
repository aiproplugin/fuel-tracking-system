import { auditListSchema } from "@/lib/schemas/master-data";
import { createTRPCRouter, roleProcedure } from "@/server/api/trpc";
import { listAuditEvents } from "@/server/services/audit.service";

/** Read-only audit trail: MANAGER and ADMIN (data scope: all). */
export const auditRouter = createTRPCRouter({
  list: roleProcedure(["MANAGER", "ADMIN"])
    .input(auditListSchema)
    .query(({ input }) => listAuditEvents(input)),
});
