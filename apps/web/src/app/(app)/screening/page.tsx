import type { Metadata } from "next";
import { ScreeningSearchPage } from "@/features/screening/components/screening-search-page";

export const metadata: Metadata = { title: "スクリーニング検索" };

// S2 スクリーニング検索。ページは結線のみ・表示ロジックは feature 層（ui-spec 3.1 — U3）
export default function ScreeningRoute() {
  return <ScreeningSearchPage />;
}
