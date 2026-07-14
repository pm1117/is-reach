// useJobPolling（PR6b 共通基盤 — ui-spec 4.5）:
// アクティブなジョブがある間のみポーリングし、全ジョブ終了で停止する（pr-plan PR6b テスト観点）
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/client";
import { useJobPolling } from "@/lib/jobs/use-job-polling";

const INTERVAL_MS = 1_000;

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useJobPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("アクティブな間、間隔ごとにポーリングを繰り返す", async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useJobPolling({ poll, intervalMs: INTERVAL_MS, active: true }));

    // 初回は 1 周期後から（マウント直後はデータ取得済みの前提）
    expect(poll).not.toHaveBeenCalled();
    await advance(INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(1);
    await advance(INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("全ジョブ終了（active=false）でポーリングを停止する", async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ active }) => useJobPolling({ poll, intervalMs: INTERVAL_MS, active }),
      { initialProps: { active: true } },
    );

    await advance(INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(1);

    // ポーリング結果で全ジョブが終了 → 呼び出し側が active=false にする
    rerender({ active: false });
    await advance(INTERVAL_MS * 10);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("active=false の間は最初からポーリングしない", async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useJobPolling({ poll, intervalMs: INTERVAL_MS, active: false }));

    await advance(INTERVAL_MS * 10);
    expect(poll).not.toHaveBeenCalled();
  });

  it("active が false → true に戻るとポーリングを再開する（再実行のパス）", async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ active }) => useJobPolling({ poll, intervalMs: INTERVAL_MS, active }),
      { initialProps: { active: false } },
    );

    await advance(INTERVAL_MS * 3);
    expect(poll).not.toHaveBeenCalled();

    rerender({ active: true });
    await advance(INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("アンマウントで停止し、進行中フェッチを abort して結果を破棄する", async () => {
    const pending = deferred();
    const signals: AbortSignal[] = [];
    const poll = vi.fn<(signal: AbortSignal) => Promise<void>>().mockImplementation((signal) => {
      signals.push(signal);
      return pending.promise;
    });
    const { unmount } = renderHook(() =>
      useJobPolling({ poll, intervalMs: INTERVAL_MS, active: true }),
    );

    await advance(INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(1);

    unmount();
    expect(signals[0]?.aborted).toBe(true);

    // アンマウント後に解決しても次周期は予約されない
    pending.resolve();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 10);
    });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("フェッチ失敗は lastError として公開しつつ、次周期で再試行して成功で null に戻る", async () => {
    const poll = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiClientError({
          code: "INTERNAL",
          message: "サーバーエラー",
          status: 500,
          requestId: "req-9",
        }),
      )
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useJobPolling({ poll, intervalMs: INTERVAL_MS, active: true }),
    );

    expect(result.current.lastError).toBeNull();
    await advance(INTERVAL_MS);
    expect(result.current.lastError).toEqual({ requestId: "req-9" });

    // 失敗してもポーリングは止まらず、次周期の成功でエラーが消える
    await advance(INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(result.current.lastError).toBeNull();
  });

  it("全ジョブ終了（active=false）で lastError もリセットされる（失敗通知が残留しない）", async () => {
    const poll = vi.fn().mockRejectedValue(new Error("fail"));
    const { result, rerender } = renderHook(
      ({ active }) => useJobPolling({ poll, intervalMs: INTERVAL_MS, active }),
      { initialProps: { active: true } },
    );

    await advance(INTERVAL_MS);
    expect(result.current.lastError).toEqual({ requestId: null });

    rerender({ active: false });
    expect(result.current.lastError).toBeNull();
  });

  it("ApiClientError 以外の失敗は requestId: null の lastError になる", async () => {
    const poll = vi.fn().mockRejectedValue(new Error("unexpected"));
    const { result } = renderHook(() =>
      useJobPolling({ poll, intervalMs: INTERVAL_MS, active: true }),
    );

    await advance(INTERVAL_MS);
    expect(result.current.lastError).toEqual({ requestId: null });
  });

  it("応答が間隔より遅い場合、完了までは次のリクエストを重複発行しない", async () => {
    const slow = deferred();
    const poll = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => slow.promise)
      .mockResolvedValue(undefined);
    renderHook(() => useJobPolling({ poll, intervalMs: INTERVAL_MS, active: true }));

    await advance(INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(1);

    // 応答待ちの間に何周期経過しても重複発行しない
    await advance(INTERVAL_MS * 3);
    expect(poll).toHaveBeenCalledTimes(1);

    // 完了後は 1 周期おいて再開する
    slow.resolve();
    await advance(INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(2);
  });
});
