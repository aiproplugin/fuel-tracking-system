import { redirect } from "next/navigation";
import { auth } from "@/server/auth";

/**
 * Root route: session-aware entry point. Phase 2 replaces /home with the
 * role-specific screens (operator home vs admin dashboard).
 */
export default async function RootPage() {
  const session = await auth();
  redirect(session?.user ? "/home" : "/login");
}
