"use client";

// 管理者専用画面のロールゲート（ui-spec 4.4 / 8 章 — U9）。
// URL 直打ちでメンバーが管理者専用ルートへ到達した場合に ForbiddenState を表示する。
// これは体験調整であり、セキュリティ境界はサーバー側認可（apps/api）が担う。
import type { ReactNode } from "react";
import { ForbiddenState } from "@/components/ui/forbidden-state";
import { LoadingState } from "@/components/ui/loading-state";
import { useMe } from "@/lib/auth/me-context";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { state } = useMe();

  if (state.status === "loading") {
    return <LoadingState />;
  }
  // エラー時は AppShell 側で ErrorState を表示済み（ここに到達するのは ready のみの想定）。
  // 万一に備え fail-closed で ForbiddenState に落とす。
  if (state.status !== "ready" || state.me.user.role !== "admin") {
    return <ForbiddenState />;
  }
  return <>{children}</>;
}
