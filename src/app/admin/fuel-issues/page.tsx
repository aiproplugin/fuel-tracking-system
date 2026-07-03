import type { Metadata } from "next";
import { FuelIssuesClient } from "@/components/admin/fuel-issues/fuel-issues-client";

export const metadata: Metadata = { title: "Fuel Issues" };

export default function FuelIssuesPage() {
  return <FuelIssuesClient />;
}
