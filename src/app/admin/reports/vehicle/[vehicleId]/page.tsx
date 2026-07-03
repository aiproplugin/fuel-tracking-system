import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { VehicleEfficiencyDetailView } from "@/components/admin/reports/vehicle-efficiency-detail";
import { createCaller } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";

export const metadata: Metadata = { title: "Vehicle efficiency" };

/**
 * Per-vehicle efficiency drill-down. The service enforces role/site scoping, so
 * an out-of-scope or unknown vehicle simply renders as not found.
 */
export default async function VehicleEfficiencyPage({
  params,
}: {
  params: { vehicleId: string };
}) {
  const caller = createCaller(
    await createTRPCContext({ headers: new Headers(Array.from(headers().entries())) }),
  );

  let detail;
  try {
    detail = await caller.reports.vehicleDetail({ vehicleId: params.vehicleId });
  } catch {
    notFound();
  }
  if (!detail) {
    notFound();
  }

  return <VehicleEfficiencyDetailView detail={detail} />;
}
