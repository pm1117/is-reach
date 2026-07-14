import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata: Metadata = { title: "ダッシュボード" };

// S1 ダッシュボード（3 ブロック簡易版 — U2）は PR6b で実装する
export default function DashboardPage() {
  return <PlaceholderPage title="ダッシュボード" />;
}
