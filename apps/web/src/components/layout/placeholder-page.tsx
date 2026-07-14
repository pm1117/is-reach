// PR6a のプレースホルダページ（ルーティング確定のみ — 表示ロジックは PR6b の feature 層で実装する）。
// ページ（route）はレイアウトとデータ取得の結線のみを担う（ui-spec 3.1 — U3）。
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "./page-header";

export interface PlaceholderPageProps {
  title: string;
  breadcrumbs?: ReadonlyArray<string>;
}

export function PlaceholderPage({ title, breadcrumbs }: PlaceholderPageProps) {
  return (
    <div>
      <PageHeader title={title} breadcrumbs={breadcrumbs} />
      <EmptyState
        title={`「${title}」は準備中です`}
        description="この画面の機能は今後のリリースで提供されます"
      />
    </div>
  );
}
