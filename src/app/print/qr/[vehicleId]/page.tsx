import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { PrintButton } from "@/components/admin/qr-tokens/print-button";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { createCaller } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";
import { auth } from "@/server/auth";

export const metadata: Metadata = { title: "Print QR token" };

/**
 * Printable QR sheet — deliberately OUTSIDE the admin shell so the print
 * output is chrome-free. ADMIN-only, same as every qrTokens procedure
 * (the tRPC gate is authoritative; this guard is UX).
 */
export default async function PrintQrPage({ params }: { params: { vehicleId: string } }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/home");

  const caller = createCaller(
    await createTRPCContext({ headers: new Headers(Array.from(headers().entries())) }),
  );

  let data;
  try {
    data = await caller.qrTokens.printData({ vehicleId: params.vehicleId });
  } catch {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-8">
      <div className="w-full rounded-[24px] border border-border bg-card p-8 text-center shadow-panel print:border-0 print:shadow-none">
        <div className="flex items-center justify-center gap-3">
          <Logo size="print" />
        </div>
        <h1 className="mt-4 text-3xl font-extrabold">{data.plateNumber}</h1>
        <p className="mt-1 text-sm text-muted">{data.vehicleTypeName}</p>
        <div className="mt-2 flex justify-center">
          <Badge variant={data.fuelType === "PETROL" ? "petrol" : "diesel"}>
            {data.fuelType === "PETROL" ? "Petrol" : "Diesel"}
          </Badge>
        </div>

        {/* Generated PNG data URL; pixel-exact rendering matters for scanning. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={data.qrDataUrl}
          alt={`Fuel QR code for ${data.plateNumber}`}
          className="mx-auto mt-6 h-64 w-64"
        />

        <p className="mt-6 text-xs text-muted">
          Scan at the fuel point · Issued {formatDateTime(data.tokenCreatedAt)}
        </p>
        <p className="mt-1 text-xs text-muted">
          If this sheet is lost or damaged, rotate the token in the admin console.
        </p>
      </div>

      <PrintButton />
    </main>
  );
}
