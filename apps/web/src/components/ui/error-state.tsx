import { Button } from "./button";
import { cx } from "@/lib/cx";

export interface ErrorStateProps {
  title?: string;
  /** ユーザー向け文言のみを渡す（サーバー由来の生メッセージは出さない — ui-spec 4.3） */
  message?: string;
  /** ログ相関用の参照 ID（ApiClientError.requestId — ui-spec 4.3） */
  requestId?: string | null;
  onRetry?: () => void;
  className?: string;
}

/** 取得エラーの領域単位表示。画面全体は壊さない（ui-spec 4.3） */
export function ErrorState({
  title = "読み込みに失敗しました",
  message,
  requestId,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cx(
        "flex flex-col items-center gap-2 rounded-lg border border-danger-subtle bg-danger-subtle px-4 py-12 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-danger">{title}</p>
      {message !== undefined ? <p className="text-xs text-neutral-600">{message}</p> : null}
      {typeof requestId === "string" && requestId !== "" ? (
        <p className="text-xs text-neutral-500">参照 ID: {requestId}</p>
      ) : null}
      {onRetry !== undefined ? (
        <Button size="sm" onClick={onRetry} className="mt-2">
          再試行
        </Button>
      ) : null}
    </div>
  );
}
