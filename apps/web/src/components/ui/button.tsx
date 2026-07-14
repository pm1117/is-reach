import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import { Spinner } from "./spinner";

const VARIANTS = {
  primary: "bg-primary text-primary-on hover:bg-primary-hover",
  secondary: "border border-neutral-300 bg-neutral-0 text-neutral-700 hover:bg-neutral-100",
  danger: "bg-danger text-danger-on hover:bg-danger-hover",
  ghost: "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
} as const;

const SIZES = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  /** true の間はスピナー表示 + 無効化（ui-spec 4.1: ボタン内スピナー + 無効化） */
  loading?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  type,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      disabled={disabled === true || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : null}
      {children}
    </button>
  );
}
