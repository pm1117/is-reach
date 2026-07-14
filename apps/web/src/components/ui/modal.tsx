"use client";

// モーダルは「短い確認・単純入力」専用（ui-spec 1.2 — 長時間作業は独立画面で行う）。
import { useEffect, type ReactNode } from "react";
import { cx } from "@/lib/cx";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** フッター（アクションボタン列）。右寄せで表示する */
  footer?: ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, children, footer, className }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-neutral-900/50"
        onClick={onClose}
        aria-label="閉じる"
        tabIndex={-1}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          "relative z-10 w-full max-w-md rounded-lg bg-neutral-0 p-4 shadow-lg",
          className,
        )}
      >
        <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
        <div className="mt-3">{children}</div>
        {footer !== undefined ? <div className="mt-4 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
