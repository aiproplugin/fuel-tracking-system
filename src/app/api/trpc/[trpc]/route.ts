import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";
import { logger } from "@/lib/logger";

const handler = (request: Request) =>
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
  });

export { handler as GET, handler as POST };
