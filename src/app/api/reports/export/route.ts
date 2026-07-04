import { ZodError } from "zod";
import { TRPCError } from "@trpc/server";
import { exportQuerySchema } from "@/lib/schemas/reports";
import { logger } from "@/lib/logger";
import { auth } from "@/server/auth";
import { clientIpFromHeaders, runWithRequestContext } from "@/server/context/request-context";
import { exportRateLimiter } from "@/server/security/rate-limit";
import type { Actor } from "@/server/services/actor";
import { recordAuditEvent } from "@/server/services/audit.service";
import { reportToCsv } from "@/server/services/reports/csv";
import { REPORT_DESCRIPTORS } from "@/server/services/reports/report-registry";
import { runReport } from "@/server/services/reports/report.service";
import { reportToXlsx } from "@/server/services/reports/xlsx";

// exceljs + Prisma need the Node runtime; never statically cache a scoped export.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Export row ceiling — larger than the on-screen cap, still bounded. */
const EXPORT_ROW_LIMIT = 50_000;

const ADMIN_ROLES = new Set(["SUPERVISOR", "MANAGER", "ADMIN"]);

/**
 * Binary export endpoint for reports. SECURITY: authenticates via the server
 * session and builds the Actor from it — NEVER from the request — then calls
 * the SAME runReport the on-screen view uses, so scoping cannot be bypassed by
 * tampering with query params and the exported numbers match the screen.
 *
 * Additionally (Phase 7): per-user rate limiting, and every successful export
 * is written to the append-only audit trail as REPORT_EXPORTED, attributed to
 * the request's client IP via the bound request context.
 */
export async function GET(request: Request): Promise<Response> {
  return runWithRequestContext({ ipAddress: clientIpFromHeaders(request.headers) }, async () => {
    const session = await auth();
    if (!session?.user) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (session.user.mustChangePassword || !ADMIN_ROLES.has(session.user.role)) {
      return new Response("Forbidden", { status: 403 });
    }

    // Rate limit per authenticated user (exports are heavy binary downloads).
    const rate = exportRateLimiter.consume(session.user.id);
    if (!rate.allowed) {
      return new Response("Too many export requests. Please try again shortly.", {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) },
      });
    }

    const params = Object.fromEntries(new URL(request.url).searchParams);

    try {
      const query = exportQuerySchema.parse(params);
      const descriptor = REPORT_DESCRIPTORS[query.reportKey];

      if (query.format === "xlsx" && !descriptor.xlsx) {
        return new Response("XLSX export is not available for this report.", { status: 400 });
      }

      const actor: Actor = {
        id: session.user.id,
        role: session.user.role,
        siteId: session.user.siteId ?? null,
      };

      const result = await runReport(
        actor,
        query.reportKey,
        {
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          siteId: query.siteId,
          vehicleId: query.vehicleId,
          tankId: query.tankId,
        },
        { rowLimit: EXPORT_ROW_LIMIT },
      );

      // Audit AFTER a successful scoped run (before streaming the body). Records
      // WHAT was exported and the requested filters — never any row data/PII.
      await recordAuditEvent({
        actorId: session.user.id,
        action: "REPORT_EXPORTED",
        entityType: "report",
        entityId: query.reportKey,
        after: {
          format: query.format,
          rowCount: result.rows.length,
          totalRows: result.totalRows,
          filters: {
            dateFrom: query.dateFrom ?? null,
            dateTo: query.dateTo ?? null,
            siteId: query.siteId ?? null,
            vehicleId: query.vehicleId ?? null,
            tankId: query.tankId ?? null,
          },
        },
      });

      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `${query.reportKey}-${stamp}.${query.format}`;

      if (query.format === "xlsx") {
        const buffer = await reportToXlsx(result);
        return new Response(buffer, {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
          },
        });
      }

      return new Response(reportToCsv(result), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return new Response("Invalid report parameters.", { status: 400 });
      }
      if (error instanceof TRPCError) {
        const status = error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 400;
        return new Response(error.message, { status });
      }
      logger.error({ err: error }, "Report export failed");
      return new Response("Export failed.", { status: 500 });
    }
  });
}
