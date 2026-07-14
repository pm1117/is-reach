"use client";

import { useId, type SelectHTMLAttributes } from "react";
import { cx } from "@/lib/cx";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: ReadonlyArray<SelectOption>;
  /** 先頭に置く未選択項目のラベル（省略時は置かない） */
  placeholder?: string;
}

export function Select({
  label,
  error,
  options,
  placeholder,
  id,
  className,
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const errorId = `${selectId}-error`;
  const hasError = error !== undefined && error !== "";
  return (
    <div className={className}>
      {label !== undefined ? (
        <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-neutral-700">
          {label}
        </label>
      ) : null}
      <select
        id={selectId}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : undefined}
        className={cx(
          "w-full rounded-md border bg-neutral-0 px-2.5 py-1.5 text-sm text-neutral-900",
          "focus:outline-2 focus:outline-primary disabled:bg-neutral-100 disabled:text-neutral-500",
          hasError ? "border-danger" : "border-neutral-300",
        )}
        {...rest}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hasError ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
