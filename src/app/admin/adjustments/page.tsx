import type { Metadata } from "next";
import { ComingSoon } from "@/components/admin/coming-soon";

export const metadata: Metadata = { title: "Adjustments" };

export default function AdjustmentsPage() {
  return (
    <ComingSoon
      eyebrow="Operations"
      title="Adjustments"
      phase="Phase 4"
      description="Supervisor/admin stock corrections with mandatory reasons, written as ADJUSTMENT movements to the append-only ledger."
    />
  );
}
