import type { Metadata } from "next";
import { VehiclesClient } from "@/components/admin/vehicles/vehicles-client";

export const metadata: Metadata = { title: "Vehicles" };

export default function VehiclesPage() {
  return <VehiclesClient />;
}
