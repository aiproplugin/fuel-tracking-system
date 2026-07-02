import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { TRPCProvider } from "@/components/providers/trpc-provider";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Fuel Usage & Stock Tracking",
    template: "%s · Fuel Usage & Stock Tracking",
  },
  description: "Internal operations portal for issued fuel, deliveries, stock, and audit control.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={cn(inter.variable, "min-h-screen bg-bg font-sans text-text")}>
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
