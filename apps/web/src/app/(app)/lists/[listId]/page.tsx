import type { Metadata } from "next";
import { ListDetailPage } from "@/features/lists/components/list-detail-page";

export const metadata: Metadata = { title: "リスト詳細" };

// S4 リスト詳細（業務のハブ画面）。ページは結線のみ・表示ロジックは feature 層（ui-spec 3.1 — U3）。
// listId は URL 由来の未検証文字列だが、apps/api 側で UUID 検証され不正時は
// VALIDATION_FAILED → 画面は ErrorState を表示する。
export default async function ListDetailRoute({ params }: { params: Promise<{ listId: string }> }) {
  const { listId } = await params;
  return <ListDetailPage listId={listId} />;
}
