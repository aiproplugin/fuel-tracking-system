import type { Metadata } from "next";
import { ComingSoon } from "@/components/admin/coming-soon";

export const metadata: Metadata = { title: "Deliveries" };

export default function DeliveriesPage() {
  return (
    <ComingSoon
      eyebrow="Operations"
      title="Deliveries"
      phase="Phase 4"
      description="Delivery entry writing DELIVERY movements to the stock ledger, with supplier references and reconciliation checks."
    />
  );
}
