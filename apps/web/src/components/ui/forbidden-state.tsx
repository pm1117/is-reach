import Link from "next/link";

export interface ForbiddenStateProps {
  message?: string;
  className?: string;
}

/**
 * 権限なし表示（ui-spec 4.4 — U9）。
 * ナビ非表示が第一線だが、URL 直打ちで管理者専用画面に到達した場合に表示する。
 * UI の出し分けはセキュリティ境界ではない（サーバー側認可 = apps/api が本線）。
 */
export function ForbiddenState({
  message = "この画面は管理者のみ利用できます",
  className,
}: ForbiddenStateProps) {
  return (
    <div className={className}>
      <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
        <p className="text-sm font-medium text-neutral-700">{message}</p>
        <Link
          href="/dashboard"
          className="rounded-md border border-neutral-300 bg-neutral-0 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
        >
          ダッシュボードへ戻る
        </Link>
      </div>
    </div>
  );
}
