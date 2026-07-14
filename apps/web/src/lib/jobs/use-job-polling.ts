"use client";

// 汎用ジョブポーリングフック（ui-spec 4.5 — 決定）。
// アクティブなジョブ（queued / collecting / analyzing 等の実行中状態）が画面内にある間のみ
// ポーリングし、全ジョブ終了（active = false）で停止する。
// 間隔は lib/config/polling.ts の値（design-detail E13: 2/3/10 秒）を渡すこと。
import { useEffect, useRef, useState } from "react";
import { ApiClientError } from "@/lib/api/client";

export interface UseJobPollingOptions {
  /**
   * 現在のジョブ群を再取得して呼び出し側の状態を更新する関数。
   * 渡される AbortSignal はアンマウント・停止時に abort される（対応は任意）。
   */
  poll: (signal: AbortSignal) => Promise<void>;
  /** ポーリング間隔（ms）。lib/config/polling.ts の値を使う */
  intervalMs: number;
  /** 継続条件: アクティブなジョブが 1 件以上あるか。false でポーリングを停止する */
  active: boolean;
}

export interface JobPollingResult {
  /**
   * 直近周期の取得失敗（次周期の成功で null に戻る）。
   * 失敗しても既存表示は壊さず次周期で再試行するため、表示するとしても
   * 補足的な通知に留めること（ui-spec 4.3: 画面全体を壊さない）。
   */
  lastError: { requestId: string | null } | null;
}

export function useJobPolling({
  poll,
  intervalMs,
  active,
}: UseJobPollingOptions): JobPollingResult {
  const [lastError, setLastError] = useState<JobPollingResult["lastError"]>(null);
  // poll の参照変化（レンダーごとの再生成）でポーリング周期をリセットしないよう ref 経由で最新を呼ぶ
  const pollRef = useRef(poll);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    if (!active) {
      // 停止時は直前周期の失敗通知も消す（全ジョブ終了後にエラー表示が残留しないように）
      setLastError(null);
      return;
    }
    // アンマウント・停止後に進行中フェッチの結果（setState）を破棄するフラグ + abort
    let disposed = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    // 次周期は前周期のフェッチ完了後に予約する（setInterval 相当だが、
    // 応答が間隔より遅い場合にリクエストが重複しないようにする）
    const tick = async (): Promise<void> => {
      try {
        await pollRef.current(controller.signal);
        if (!disposed) {
          setLastError(null);
        }
      } catch (error) {
        // ポーリング中の失敗は既存表示を壊さず、次周期で再試行する（ui-spec 4.5）
        if (!disposed) {
          setLastError({
            requestId: error instanceof ApiClientError ? error.requestId : null,
          });
        }
      }
      if (!disposed) {
        timer = setTimeout(() => void tick(), intervalMs);
      }
    };
    // 初回はデータ取得直後（ジョブ起動 or 一覧取得）である前提のため、1 周期後から開始する
    timer = setTimeout(() => void tick(), intervalMs);

    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, intervalMs]);

  return { lastError };
}
