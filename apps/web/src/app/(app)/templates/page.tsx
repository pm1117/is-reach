import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata: Metadata = { title: "テンプレート" };

// S7 テンプレート管理は PR6b で実装する（閲覧は全員・変更ボタンは管理者のみ表示 — E3/U9）
export default function TemplatesPage() {
  return <PlaceholderPage title="テンプレート" />;
}
