"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import type { Role } from "@prisma/client";
import { Logo } from "@/components/brand/logo";
import type { Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  /** The permission that gates the section's primary procedure. */
  permission: Permission;
}

/**
 * Nav order and labels from prototype D1; visibility follows the SAME
 * permission the section's procedures require, so a granted or denied
 * override is reflected in the nav. Hiding is UX only — every procedure
 * re-checks server-side.
 */
const NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", href: "/admin", permission: "dashboard.view" },
  { label: "Fuel Issues", href: "/admin/fuel-issues", permission: "fuelissue.view" },
  { label: "Deliveries", href: "/admin/deliveries", permission: "ledger.view" },
  { label: "Adjustments", href: "/admin/adjustments", permission: "ledger.view" },
  { label: "Vehicles", href: "/admin/vehicles", permission: "masterdata.view" },
  { label: "Quotas", href: "/admin/quotas", permission: "quota.view" },
  { label: "Companies", href: "/admin/companies", permission: "masterdata.manage" },
  { label: "Sites", href: "/admin/sites", permission: "masterdata.manage" },
  { label: "Tanks", href: "/admin/tanks", permission: "masterdata.view" },
  { label: "Reports", href: "/admin/reports", permission: "report.run" },
  { label: "Users", href: "/admin/users", permission: "user.manage" },
  { label: "Access", href: "/admin/access", permission: "permission.manage" },
  { label: "QR Tokens", href: "/admin/qr-tokens", permission: "qrtoken.manage" },
  { label: "Audit", href: "/admin/audit", permission: "audit.view" },
  { label: "Settings", href: "/admin/settings", permission: "masterdata.manage" },
];

export interface SidebarNavProps {
  permissions: readonly Permission[];
  role: Role;
  displayName: string;
  username: string;
}

export function SidebarNav({ permissions, role, displayName, username }: SidebarNavProps) {
  const pathname = usePathname();
  const held = new Set(permissions);
  const visibleItems = NAV_ITEMS.filter((item) => held.has(item.permission));

  function isActive(href: string): boolean {
    return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
  }

  return (
    <aside className="flex flex-col bg-sidebar p-6 text-slate-200 print:hidden">
      <div className="mb-8 flex items-center gap-3">
        <Logo size="sm" className="border-white/10" />
        <div>
          <p className="font-semibold text-white">Fuel Tracking</p>
          <p className="text-xs text-slate-400">Admin console</p>
        </div>
      </div>

      <nav className="space-y-2 text-sm" aria-label="Admin navigation">
        {visibleItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={cn(
              "block rounded-2xl px-4 py-3 transition-colors",
              isActive(item.href)
                ? "bg-white/10 font-semibold text-white"
                : "hover:bg-white/5 hover:text-white",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto border-t border-white/10 pt-5">
        <p className="truncate text-sm font-semibold text-white">{displayName}</p>
        <p className="truncate text-xs text-slate-400">
          {username} · {role.toLowerCase()}
        </p>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="mt-3 w-full rounded-2xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
