import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata: Metadata = { title: "スクリーニング検索" };

// S2 スクリーニング検索は PR6b で実装する
export default function ScreeningPage() {
  return <PlaceholderPage title="スクリーニング検索" />;
}
