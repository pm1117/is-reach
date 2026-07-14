"use client";

// トースト（ui-spec 4.3: 操作エラー・成功の通知）。ToastProvider 配下で useToast() を使う。
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cx } from "@/lib/cx";

const AUTO_DISMISS_MS = 5_000;

const TONES = {
  success: "border-l-success",
  danger: "border-l-danger",
  neutral: "border-l-neutral-400",
} as const;

export interface ToastInput {
  tone: keyof typeof TONES;
  message: string;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastContextValue {
  showToast: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error("useToast は ToastProvider の配下でのみ使用できます");
  }
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ReadonlyArray<ToastItem>>([]);
  const nextIdRef = useRef(1);

  const showToast = useCallback((toast: ToastInput) => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setToasts((current) => [...current, { ...toast, id }]);
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "danger" ? "alert" : "status"}
            className={cx(
              "rounded-md border border-neutral-200 border-l-4 bg-neutral-0 px-3 py-2 text-sm text-neutral-800 shadow-lg",
              TONES[toast.tone],
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
