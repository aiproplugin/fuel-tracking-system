import type { Metadata } from "next";
import { AdjustmentsClient } from "@/components/admin/adjustments/adjustments-client";

export const metadata: Metadata = { title: "Adjustments" };

export default function AdjustmentsPage() {
  return <AdjustmentsClient />;
}
