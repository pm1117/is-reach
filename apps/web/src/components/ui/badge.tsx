import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

const TONES = {
  primary: "bg-primary-subtle text-primary",
  danger: "bg-danger-subtle text-danger",
  warning: "bg-warning-subtle text-warning-hover",
  success: "bg-success-subtle text-success-hover",
  neutral: "bg-neutral-subtle text-neutral-700",
} as const;

export interface BadgeProps {
  tone?: keyof typeof TONES;
  children: ReactNode;
  className?: string;
}

/** 状態・種別表示用バッジ（シグナル種別・ジョブ状態・ロール等） */
export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
