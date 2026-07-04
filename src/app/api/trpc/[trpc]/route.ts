import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";
import { logger } from "@/lib/logger";
import { clientIpFromHeaders, runWithRequestContext } from "@/server/context/request-context";

// Prisma + AsyncLocalStorage need the Node.js runtime (not edge).
export const runtime = "nodejs";

/**
 * Bind the request-scoped context (client IP) for the whole resolver tree so
 * audit events written by any service are attributed to the originating
 * request without threading the IP through every call.
 */
const handler = (request: Request) =>
  runWithRequestContext({ ipAddress: clientIpFromHeaders(request.headers) }, () =>
    fetchRequestHandler({
      endpoint: "/api/trpc",
      req: request,
      router: appRouter,
      createContext: () => createTRPCContext({ headers: request.headers }),
      onError({ error, path }) {
        // Full detail stays server-side; clients only ever see the formatted
        // tRPC error (see errorFormatter in src/server/api/trpc.ts).
        logger.error({ path, code: error.code, message: error.message }, "tRPC request failed");
      },
    }),
  );

export { handler as GET, handler as POST };
