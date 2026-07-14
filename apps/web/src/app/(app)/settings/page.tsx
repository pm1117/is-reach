import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { RequireAdmin } from "@/components/layout/require-admin";

export const metadata: Metadata = { title: "設定" };

// S8 テナント設定・ユーザー管理（管理者のみ — U9）。画面本体は PR6b で実装する
export default function SettingsPage() {
  return (
    <RequireAdmin>
      <PlaceholderPage title="テナント設定・ユーザー管理" />
    </RequireAdmin>
  );
}
