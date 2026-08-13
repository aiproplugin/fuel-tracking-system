import { redirect } from "next/navigation";
import { SidebarNav } from "@/components/admin/sidebar-nav";
import type { Permission } from "@/lib/permissions";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { buildActor } from "@/server/services/permission.service";

/**
 * Shell / Desktop / AdminLayout — 248px dark sidebar + light content
 * (prototype D1).
 *
 * Effective permissions are resolved server-side here and passed to the nav so
 * it only shows sections the user can actually open. This guard is UX ONLY —
 * the real enforcement is the permission check on every tRPC procedure, which
 * re-resolves independently and does not trust anything rendered here.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }

  const actor = await buildActor(db, {
    id: session.user.id,
    role: session.user.role,
    siteId: session.user.siteId ?? null,
    defaultTankId: session.user.defaultTankId ?? null,
  });

  // The admin area is for users who can see admin data at all. Anyone holding
  // none of it (a plain operator) belongs on the operator home screen.
  if (actor.permissions.size === 0 || !actor.permissions.has("dashboard.view")) {
    redirect("/home");
  }

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[248px_1fr]">
      <SidebarNav
        permissions={[...actor.permissions] as Permission[]}
        role={session.user.role}
        displayName={session.user.displayName}
        username={session.user.username}
      />
      <main className="bg-bg p-5 lg:p-8">{children}</main>
    </div>
  );
}
