import { redirect } from "next/navigation";

/**
 * Root route. Phase 1 adds session-aware routing (operator home vs admin
 * dashboard); until then everything lands on the login screen.
 */
export default function RootPage() {
  redirect("/login");
}
