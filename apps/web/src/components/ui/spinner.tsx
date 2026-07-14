import { cx } from "@/lib/cx";

const SIZES = {
  sm: "size-4",
  md: "size-6",
} as const;

export interface SpinnerProps {
  size?: keyof typeof SIZES;
  className?: string;
}

/** 操作フィードバック用スピナー（ui-spec 4.1: 操作へのフィードバック = スピナー） */
export function Spinner({ size = "md", className }: SpinnerProps) {
  return (
    <svg
      className={cx("animate-spin text-current", SIZES[size], className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}
