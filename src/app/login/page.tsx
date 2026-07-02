import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * M1_Login — matches Frame / Mobile / M1_Login in docs/fuel-ui-prototype.html:
 * "F" logo tile, extrabold product title, muted description, rounded-[24px]
 * panel with username/password + teal Sign in, on-prem helper text.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-md">
        <div
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-xl font-extrabold text-primary"
        >
          F
        </div>

        <h1 className="mt-6 text-3xl font-extrabold tracking-tight">
          Fuel Usage &amp; Stock Tracking
        </h1>
        <p className="mt-3 text-muted">
          Internal operations portal for issued fuel, deliveries, stock, and audit control.
        </p>

        <div className="mt-8 rounded-[24px] border border-border bg-card p-5 shadow-panel sm:p-6">
          <LoginForm />
          <p className="mt-4 text-xs text-muted">Authorized staff only · On-prem secure network</p>
        </div>
      </div>
    </main>
  );
}
