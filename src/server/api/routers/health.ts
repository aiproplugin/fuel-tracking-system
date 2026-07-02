import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

/**
 * Health router — proves the full tRPC pipeline (client -> route handler ->
 * router -> procedure) works before any business logic exists.
 */
export const healthRouter = createTRPCRouter({
  status: publicProcedure.query(() => ({
    status: "ok" as const,
    timestamp: new Date().toISOString(),
  })),
});
