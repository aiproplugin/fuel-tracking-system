import type { Metadata } from "next";
import { AccessClient } from "@/components/admin/access/access-client";

export const metadata: Metadata = { title: "Access" };

export default function AccessPage() {
  return <AccessClient />;
}
