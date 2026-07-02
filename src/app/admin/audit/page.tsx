import type { Metadata } from "next";
import { AuditClient } from "@/components/admin/audit/audit-client";

export const metadata: Metadata = { title: "Audit" };

export default function AuditPage() {
  return <AuditClient />;
}
