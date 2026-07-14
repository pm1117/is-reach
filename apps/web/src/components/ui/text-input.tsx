"use client";

import { useId, type InputHTMLAttributes } from "react";
import { cx } from "@/lib/cx";

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** バリデーションエラー文言（ユーザー向け日本語。サーバー生メッセージは渡さない — ui-spec 4.3） */
  error?: string;
}

export function TextInput({ label, error, id, className, ...rest }: TextInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hasError = error !== undefined && error !== "";
  return (
    <div className={className}>
      {label !== undefined ? (
        <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-neutral-700">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : undefined}
        className={cx(
          "w-full rounded-md border bg-neutral-0 px-2.5 py-1.5 text-sm text-neutral-900",
          "placeholder:text-neutral-400 focus:outline-2 focus:outline-primary",
          "disabled:bg-neutral-100 disabled:text-neutral-500",
          hasError ? "border-danger" : "border-neutral-300",
        )}
        {...rest}
      />
      {hasError ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
