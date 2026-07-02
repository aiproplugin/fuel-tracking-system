import { redirect } from "next/navigation";
import { auth } from "@/server/auth";

/**
 * Root route: session-aware entry point. Operators land on their home
 * (M2 arrives in Phase 3); supervisor and above land on the admin console.
 */
export default async function RootPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }
  redirect(session.user.role === "OPERATOR" ? "/home" : "/admin");
}
