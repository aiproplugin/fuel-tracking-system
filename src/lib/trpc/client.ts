import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@/server/api/root";

/**
 * Typed tRPC React client. Import as `api` in client components:
 *   const { data } = api.health.status.useQuery();
 */
export const api = createTRPCReact<AppRouter>();
