import type { Metadata } from "next";
import { QrTokensClient } from "@/components/admin/qr-tokens/qr-tokens-client";

export const metadata: Metadata = { title: "QR Tokens" };

export default function QrTokensPage() {
  return <QrTokensClient />;
}
