import type { Metadata } from "next";
import { RequireAdmin } from "@/components/layout/require-admin";
import { AuditLogsScreen } from "@/features/audit/components/audit-logs-screen";

export const metadata: Metadata = { title: "監査ログ" };

// S9 監査ログ閲覧（管理者のみ — U9・閲覧専用）。ルートは結線のみ
export default function AuditLogsPage() {
  return (
    <RequireAdmin>
      <AuditLogsScreen />
    </RequireAdmin>
  );
}
