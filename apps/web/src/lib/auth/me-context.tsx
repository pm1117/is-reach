"use client";

// GET /me の結果（自ユーザー・テナント・ロール）を認証済みレイアウト配下へ供給する。
// ロールはナビ・画面の出し分け（ui-spec 8 章 — U9）に使う。サーバー側認可が本線であり、
// この出し分けはセキュリティ境界ではない。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MeResponse } from "@is-reach/shared";
import { getBrowserApiClient } from "@/lib/api/browser";
import { ApiClientError } from "@/lib/api/client";
import { fetchMe } from "@/lib/api/me";

export type MeState =
  | { status: "loading" }
  | { status: "error"; requestId: string | null }
  | { status: "ready"; me: MeResponse };

export interface MeContextValue {
  state: MeState;
  reload: () => void;
}

const MeContext = createContext<MeContextValue | null>(null);

export function useMe(): MeContextValue {
  const context = useContext(MeContext);
  if (context === null) {
    throw new Error("useMe は MeProvider の配下でのみ使用できます");
  }
  return context;
}

export function MeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MeState>({ status: "loading" });

  const reload = useCallback(() => {
    setState({ status: "loading" });
    void (async () => {
      try {
        const me = await fetchMe(getBrowserApiClient());
        setState({ status: "ready", me });
      } catch (error) {
        setState({
          status: "error",
          requestId: error instanceof ApiClientError ? error.requestId : null,
        });
      }
    })();
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo(() => ({ state, reload }), [state, reload]);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

/**
 * テスト用: 取得済みの状態を直接注入するプロバイダ。
 * アプリコードからは MeProvider のみを使うこと。
 */
export function MeStateProvider({
  value,
  children,
}: {
  value: MeContextValue;
  children: ReactNode;
}) {
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}
