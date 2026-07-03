import type { Metadata } from "next";
import { DeliveriesClient } from "@/components/admin/deliveries/deliveries-client";

export const metadata: Metadata = { title: "Deliveries" };

export default function DeliveriesPage() {
  return <DeliveriesClient />;
}
