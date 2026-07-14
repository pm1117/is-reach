"use client";

// 認証済みレイアウト（ui-spec 1.2 — U1）: 左サイドナビ（固定幅 240px 相当）+ メインエリア（可変幅）。
// /me の取得状態でメインエリアを出し分ける（ローディング / エラー+再試行 / 通常表示）。
import type { ReactNode } from "react";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import { useMe } from "@/lib/auth/me-context";
import { SideNav } from "./side-nav";

export function AppShell({ children }: { children: ReactNode }) {
  const { state, reload } = useMe();

  return (
    <div className="flex min-h-screen">
      <SideNav me={state.status === "ready" ? state.me : null} />
      <div className="min-w-0 flex-1">
        {state.status === "loading" ? (
          <LoadingState label="ユーザー情報を読み込んでいます…" />
        ) : null}
        {state.status === "error" ? (
          <div className="p-6">
            <ErrorState
              title="ユーザー情報の取得に失敗しました"
              message="時間をおいて再試行してください"
              requestId={state.requestId}
              onRetry={reload}
            />
          </div>
        ) : null}
        {state.status === "ready" ? <main className="p-6">{children}</main> : null}
      </div>
    </div>
  );
}
