import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { createCaller } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";
import { auth } from "@/server/auth";

export const metadata: Metadata = {
  title: "Home",
};

/**
 * Phase 1 authenticated landing page — proves session, role binding, and
 * the operator tank binding end to end. Replaced in Phase 2 by the real
 * M2 Operator Home and D1 Admin Dashboard.
 */
export default async function HomePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Through the tRPC caller so this page exercises the same authorized
  // pipeline the client uses (UI -> tRPC -> service -> Prisma).
  const caller = createCaller(
    await createTRPCContext({ headers: new Headers(Array.from(headers().entries())) }),
  );
  const me = await caller.auth.me();

  const fuelChipVariant = me.defaultTank?.fuelType === "PETROL" ? "petrolOnDark" : "dieselOnDark";
  const fuelLabel = me.defaultTank?.fuelType === "PETROL" ? "Petrol" : "Diesel";

  return (
    <main className="flex min-h-dvh flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-md space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted">Signed in</p>
            <h1 className="text-2xl font-bold">{me.displayName}</h1>
          </div>
          <Badge variant="info">{me.role}</Badge>
        </div>

        {me.defaultTank ? (
          <div className="rounded-[24px] bg-sidebar p-5 text-white">
            <p className="text-sm text-slate-300">Assigned tank</p>
            <div className="mt-2 flex items-end justify-between">
              <div>
                <h2 className="text-xl font-bold">{me.defaultTank.name}</h2>
                <Badge variant={fuelChipVariant} className="mt-3">
                  {fuelLabel}
                </Badge>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-300">Current stock</p>
                <p className="text-3xl font-extrabold">
                  {me.defaultTank.currentStockLiters.toLocaleString("en-US")} L
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[24px] border border-border bg-card p-5 shadow-panel">
            <p className="text-sm text-muted">Workspace</p>
            <p className="mt-1 font-semibold">
              {me.siteName ?? "All sites"} · {me.role.toLowerCase()} access
            </p>
            <p className="mt-3 text-sm text-muted">
              Role dashboards arrive in Phase 2. This page confirms your account, role, and scope
              are wired correctly.
            </p>
          </div>
        )}

        <div className="rounded-[24px] border border-border bg-card p-5 shadow-panel">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Username</span>
            <span className="font-semibold">{me.username}</span>
          </div>
          {me.siteName ? (
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-muted">Site</span>
              <span className="font-semibold">{me.siteName}</span>
            </div>
          ) : null}
        </div>

        <SignOutButton />
      </div>
    </main>
  );
}
