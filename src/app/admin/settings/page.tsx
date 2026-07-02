import type { Metadata } from "next";
import { SettingsClient } from "@/components/admin/settings/settings-client";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return <SettingsClient />;
}
