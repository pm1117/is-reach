"use client";

// 汎用データ取得フック。me-context.tsx と同じ状態モデル
// （loading / error(requestId) / ready(data) + reload — ui-spec 4.1 / 4.3）を
// 一覧・詳細画面のデータ取得へ一般化する。
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClientError } from "@/lib/api/client";

export type ApiQueryState<T> =
  | { status: "loading" }
  | { status: "error"; requestId: string | null }
  | { status: "ready"; data: T };

export interface ApiQueryResult<T> {
  state: ApiQueryState<T>;
  /** 同じ fetchFn で再取得する（エラー時の「再試行」/ 操作後の一覧更新用） */
  reload: () => void;
}

/**
 * @param fetchFn データを取得する関数。参照が変わると再取得されるため、
 *   呼び出し側で useCallback 等により安定化して渡すこと（検索条件・ページ番号の
 *   変更は fetchFn の deps に含めれば自動で再取得になる）。
 *   渡される AbortSignal はアンマウント・reload 時に abort される（対応は任意）。
 */
export function useApiQuery<T>(fetchFn: (signal: AbortSignal) => Promise<T>): ApiQueryResult<T> {
  const [state, setState] = useState<ApiQueryState<T>>({ status: "loading" });
  // reload はフェッチ世代を進めるだけにし、実行は effect に一本化する
  // （アンマウント後の setState 防止を effect のクリーンアップで一元管理するため）
  const [generation, setGeneration] = useState(0);

  const reload = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);

  useEffect(() => {
    // アンマウント・世代交代後に古いフェッチの結果で setState しない（active フラグ + abort）
    let active = true;
    const controller = new AbortController();
    setState({ status: "loading" });
    void (async () => {
      try {
        const data = await fetchFn(controller.signal);
        if (active) {
          setState({ status: "ready", data });
        }
      } catch (error) {
        if (active) {
          setState({
            status: "error",
            requestId: error instanceof ApiClientError ? error.requestId : null,
          });
        }
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [fetchFn, generation]);

  return useMemo(() => ({ state, reload }), [state, reload]);
}
