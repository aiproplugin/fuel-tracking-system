import type { Metadata } from "next";
import { ReportsClient } from "@/components/admin/reports/reports-client";

export const metadata: Metadata = { title: "Reports" };

/** Reports & export workspace (supervisor+). Data + scoping live in the service. */
export default function ReportsPage() {
  return <ReportsClient />;
}
