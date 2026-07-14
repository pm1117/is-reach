import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata: Metadata = { title: "企業詳細" };

// S5 企業詳細（ドシエ + メッセージ）は PR6b で実装する
export default async function EntryDetailPage({
  params,
}: {
  params: Promise<{ listId: string; entryId: string }>;
}) {
  await params;
  return <PlaceholderPage title="企業詳細" breadcrumbs={["リスト", "リスト詳細", "企業詳細"]} />;
}
