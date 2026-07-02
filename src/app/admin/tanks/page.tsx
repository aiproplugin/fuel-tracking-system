import type { Metadata } from "next";
import { TanksClient } from "@/components/admin/tanks/tanks-client";

export const metadata: Metadata = { title: "Tanks" };

export default function TanksPage() {
  return <TanksClient />;
}
