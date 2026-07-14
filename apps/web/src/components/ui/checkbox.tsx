"use client";

import { useEffect, useId, useRef, type InputHTMLAttributes } from "react";
import { cx } from "@/lib/cx";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  /**
   * 一部選択状態（テーブルヘッダの全選択チェックボックス用）。
   * HTML 属性でなく DOM プロパティのため ref 経由で反映する。
   * ラベルなし利用時（テーブルヘッダ等）は aria-label を必ず渡すこと。
   */
  indeterminate?: boolean;
}

/**
 * 汎用チェックボックス（テーブル行の複数選択・ヘッダの全選択用）。
 * className は label あり時はラッパー div、label なし時は input 自体へ適用される。
 */
export function Checkbox({ label, indeterminate = false, id, className, ...rest }: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);

  // deps なしで毎コミット反映する（代入は冪等）。ユーザークリックでブラウザが
  // indeterminate をネイティブに false へ戻した後、prop が同値のまま再レンダーされる
  // ケースでも DOM との乖離を残さないため。
  useEffect(() => {
    if (inputRef.current !== null) {
      inputRef.current.indeterminate = indeterminate;
    }
  });

  const input = (
    <input
      ref={inputRef}
      id={inputId}
      type="checkbox"
      className={cx(
        // ネイティブ描画のまま accent-color でトークンに合わせる（border 等は反映されないため付けない）
        "size-4 shrink-0 accent-primary",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        label === undefined ? className : undefined,
      )}
      {...rest}
    />
  );

  if (label === undefined) {
    return input;
  }
  return (
    <div className={cx("flex items-center gap-1.5", className)}>
      {input}
      <label htmlFor={inputId} className="text-sm text-neutral-700">
        {label}
      </label>
    </div>
  );
}
