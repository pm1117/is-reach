import type { Metadata } from "next";
import { DashboardScreen } from "@/features/dashboard/components/dashboard-screen";

export const metadata: Metadata = { title: "ダッシュボード" };

// S1 ダッシュボード（3 ブロック簡易版 — 決定 U2）。ルートは結線のみ
export default function DashboardPage() {
  return <DashboardScreen />;
}
