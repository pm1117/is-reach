import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** 初回導線（ui-spec 4.2: 空状態は初回導線付き）。ボタンやリンクを渡す */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-4 py-12 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      {description !== undefined ? <p className="text-xs text-neutral-500">{description}</p> : null}
      {action !== undefined ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
