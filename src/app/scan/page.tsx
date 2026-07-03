import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ScanFlow } from "@/components/operator/scan-flow";
import { auth } from "@/server/auth";

export const metadata: Metadata = { title: "Scan vehicle QR" };

/**
 * M3–M7 + receipt: the fuel-issue flow. Operator-only, tank-bound. The
 * scanned token lives in client memory only — never in the URL.
 */
export default async function ScanPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }
  if (session.user.role !== "OPERATOR") {
    redirect("/admin");
  }
  if (!session.user.defaultTankId) {
    redirect("/home");
  }

  return <ScanFlow />;
}
