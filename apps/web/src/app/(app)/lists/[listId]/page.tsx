import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata: Metadata = { title: "リスト詳細" };

// S4 リスト詳細（業務のハブ画面）は PR6b で実装する
export default async function ListDetailPage({ params }: { params: Promise<{ listId: string }> }) {
  await params; // listId は PR6b でデータ取得に使う
  return <PlaceholderPage title="リスト詳細" breadcrumbs={["リスト", "リスト詳細"]} />;
}
