import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata: Metadata = { title: "メッセージ" };

// S6 メッセージ生成・編集（ui-spec 6 章 — U7）は PR6b で実装する
export default async function MessagePage({
  params,
}: {
  params: Promise<{ listId: string; entryId: string; messageId: string }>;
}) {
  await params;
  return (
    <PlaceholderPage
      title="メッセージ"
      breadcrumbs={["リスト", "リスト詳細", "企業詳細", "メッセージ"]}
    />
  );
}
