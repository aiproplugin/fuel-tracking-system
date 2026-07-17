import type { Metadata } from "next";
import { CompaniesClient } from "@/components/admin/companies/companies-client";

export const metadata: Metadata = { title: "Companies" };

export default function CompaniesPage() {
  return <CompaniesClient />;
}
