import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { RequireAdmin } from "@/components/layout/require-admin";

export const metadata: Metadata = { title: "監査ログ" };

// S9 監査ログ閲覧（管理者のみ — U9）。画面本体は PR6b で実装する
export default function AuditLogsPage() {
  return (
    <RequireAdmin>
      <PlaceholderPage title="監査ログ" />
    </RequireAdmin>
  );
}
