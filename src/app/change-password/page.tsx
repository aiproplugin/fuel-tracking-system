import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { Logo } from "@/components/brand/logo";
import { auth } from "@/server/auth";

export const metadata: Metadata = { title: "Change password" };

/**
 * Forced password change after an admin-set temporary password (also usable
 * voluntarily). On success the user is signed out and signs back in, which
 * refreshes the session claims.
 */
export default async function ChangePasswordPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main className="flex min-h-dvh flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-md">
        <Logo size="lg" className="shadow-panel" />
        <h1 className="mt-6 text-3xl font-extrabold tracking-tight">Set a new password</h1>
        <p className="mt-3 text-muted">
          {session.user.mustChangePassword
            ? "Your password was set by an administrator. Choose your own before continuing."
            : "Choose a new password for your account."}
        </p>

        <div className="mt-8 rounded-[24px] border border-border bg-card p-5 shadow-panel sm:p-6">
          <ChangePasswordForm />
          <p className="mt-4 text-xs text-muted">
            At least 12 characters with upper and lower case, a digit, and a symbol.
          </p>
        </div>
      </div>
    </main>
  );
}
