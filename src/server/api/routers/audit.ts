import { auditListSchema } from "@/lib/schemas/master-data";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import { listAuditEvents } from "@/server/services/audit.service";

/** Read-only audit trail (data scope: all). */
export const auditRouter = createTRPCRouter({
  list: permissionProcedure("audit.view")
    .input(auditListSchema)
    .query(({ input }) => listAuditEvents(input)),
});
