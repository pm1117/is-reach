import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  /**
   * パンくず（ui-spec 1.2: 「リスト一覧 > リスト名 > 企業名」）。
   * PR6a では文字列表示のみ（リンク化・実データ反映は PR6b の feature 層で行う）
   */
  breadcrumbs?: ReadonlyArray<string>;
  /** 主要アクションボタン（右寄せ） */
  actions?: ReactNode;
}

export function PageHeader({ title, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <header className="mb-6">
      {breadcrumbs !== undefined && breadcrumbs.length > 0 ? (
        <nav aria-label="パンくず" className="mb-1 text-xs text-neutral-500">
          <ol className="flex flex-wrap items-center gap-1">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${index}-${crumb}`} className="flex items-center gap-1">
                {index > 0 ? <span aria-hidden="true">&gt;</span> : null}
                <span>{crumb}</span>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
        {actions !== undefined ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
