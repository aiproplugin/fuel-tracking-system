import type { Metadata } from "next";
import { SitesClient } from "@/components/admin/sites/sites-client";

export const metadata: Metadata = { title: "Sites" };

export default function SitesPage() {
  return <SitesClient />;
}
