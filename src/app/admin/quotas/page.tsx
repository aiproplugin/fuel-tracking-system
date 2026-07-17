import type { Metadata } from "next";
import { QuotasClient } from "@/components/admin/quotas/quotas-client";

export const metadata: Metadata = { title: "Quotas" };

export default function QuotasPage() {
  return <QuotasClient />;
}
