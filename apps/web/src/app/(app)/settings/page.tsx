import type { Metadata } from "next";
import { RequireAdmin } from "@/components/layout/require-admin";
import { SettingsScreen } from "@/features/settings/components/settings-screen";

export const metadata: Metadata = { title: "設定" };

// S8 テナント設定・ユーザー管理（管理者のみ — U9）。ルートは結線のみ
export default function SettingsPage() {
  return (
    <RequireAdmin>
      <SettingsScreen />
    </RequireAdmin>
  );
}
