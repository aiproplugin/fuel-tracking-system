import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OperatorHomeClient } from "@/components/operator/operator-home-client";
import { auth } from "@/server/auth";

export const metadata: Metadata = {
  title: "Home",
};

/**
 * M2_OperatorHome — the operator's mobile home: greeting, dark assigned-tank
 * card, "Scan vehicle QR" primary action, today's stats, recent issues.
 * Non-operators belong in the admin console.
 */
export default async function HomePage() {
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

  return <OperatorHomeClient displayName={session.user.displayName} />;
}
