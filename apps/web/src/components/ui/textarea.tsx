"use client";

import { useId, type TextareaHTMLAttributes } from "react";
import { cx } from "@/lib/cx";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({ label, error, id, className, rows, ...rest }: TextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const errorId = `${textareaId}-error`;
  const hasError = error !== undefined && error !== "";
  return (
    <div className={className}>
      {label !== undefined ? (
        <label htmlFor={textareaId} className="mb-1 block text-xs font-medium text-neutral-700">
          {label}
        </label>
      ) : null}
      <textarea
        id={textareaId}
        rows={rows ?? 4}
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
