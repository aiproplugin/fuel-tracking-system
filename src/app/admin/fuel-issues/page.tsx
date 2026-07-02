import type { Metadata } from "next";
import { ComingSoon } from "@/components/admin/coming-soon";

export const metadata: Metadata = { title: "Fuel Issues" };

export default function FuelIssuesPage() {
  return (
    <ComingSoon
      eyebrow="Operations"
      title="Fuel Issues"
      phase="Phase 3"
      description="The full issue register with ledger-backed transactions, idempotent submissions, hard blocks (fuel mismatch, odometer regression), and the exception review queue."
    />
  );
}
