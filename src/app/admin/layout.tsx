import { redirect } from "next/navigation";
import { SidebarNav } from "@/components/admin/sidebar-nav";
import { auth } from "@/server/auth";

const ADMIN_AREA_ROLES = ["SUPERVISOR", "MANAGER", "ADMIN"] as const;

/**
 * Shell / Desktop / AdminLayout — 248px dark sidebar + light content
 * (prototype D1). Server-side role guard: operators never enter the admin
 * area (this guard is UX; the real enforcement is on every tRPC procedure).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }
  if (!ADMIN_AREA_ROLES.includes(session.user.role as (typeof ADMIN_AREA_ROLES)[number])) {
    redirect("/home");
  }

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[248px_1fr]">
      <SidebarNav
        role={session.user.role}
        displayName={session.user.displayName}
        username={session.user.username}
      />
      <main className="bg-bg p-5 lg:p-8">{children}</main>
    </div>
  );
}
