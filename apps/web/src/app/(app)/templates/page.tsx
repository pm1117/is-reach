import type { Metadata } from "next";
import { TemplatesScreen } from "@/features/templates/components/templates-screen";

export const metadata: Metadata = { title: "テンプレート" };

// S7 テンプレート管理（閲覧は全員・変更ボタンは管理者のみ表示 — E3/U9）。ルートは結線のみ
export default function TemplatesPage() {
  return <TemplatesScreen />;
}
