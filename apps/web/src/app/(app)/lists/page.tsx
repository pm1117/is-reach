import type { Metadata } from "next";
import { ListsPage } from "@/features/lists/components/lists-page";

export const metadata: Metadata = { title: "リスト" };

// S3 リスト一覧。ページは結線のみ・表示ロジックは feature 層（ui-spec 3.1 — U3）
export default function ListsRoute() {
  return <ListsPage />;
}
