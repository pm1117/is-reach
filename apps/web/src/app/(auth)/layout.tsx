import type { ReactNode } from "react";

// 未認証画面（S0: ログイン / 招待受諾）の中央寄せレイアウト
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-xl font-semibold text-neutral-900">is-reach</div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-0 p-6 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
