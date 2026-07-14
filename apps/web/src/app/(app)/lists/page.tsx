import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata: Metadata = { title: "リスト" };

// S3 リスト一覧は PR6b で実装する
export default function ListsPage() {
  return <PlaceholderPage title="リスト" />;
}
