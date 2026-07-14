// useApiQuery（PR6b 共通基盤）: loading / error(requestId) / ready(data) + reload の状態モデル
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/client";
import { useApiQuery } from "@/lib/api/use-api-query";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeApiError(requestId: string): ApiClientError {
  return new ApiClientError({
    code: "INTERNAL",
    message: "サーバーエラー",
    status: 500,
    requestId,
  });
}

describe("useApiQuery", () => {
  it("取得成功で loading → ready(data) に遷移する", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ items: [1, 2] });
    const { result } = renderHook(() => useApiQuery(fetchFn));

    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: "ready", data: { items: [1, 2] } });
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("ApiClientError での失敗は error(requestId) になる", async () => {
    const fetchFn = vi.fn().mockRejectedValue(makeApiError("req-42"));
    const { result } = renderHook(() => useApiQuery(fetchFn));

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: "error", requestId: "req-42" });
    });
  });

  it("ApiClientError 以外での失敗は requestId: null の error になる", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("unexpected"));
    const { result } = renderHook(() => useApiQuery(fetchFn));

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: "error", requestId: null });
    });
  });

  it("reload で loading に戻り再取得する（エラーからの再試行）", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(makeApiError("req-1"))
      .mockResolvedValueOnce("recovered");
    const { result } = renderHook(() => useApiQuery(fetchFn));

    await waitFor(() => {
      expect(result.current.state.status).toBe("error");
    });

    act(() => {
      result.current.reload();
    });
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: "ready", data: "recovered" });
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("reload 後に古いフェッチが解決しても結果を上書きしない（古い方は abort される）", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const signals: AbortSignal[] = [];
    const fetchFn = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockImplementation((signal) => {
        signals.push(signal);
        return signals.length === 1 ? first.promise : second.promise;
      });
    const { result } = renderHook(() => useApiQuery(fetchFn));

    act(() => {
      result.current.reload();
    });
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    second.resolve("新しい結果");
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: "ready", data: "新しい結果" });
    });

    // 古いフェッチが後から解決しても ready の内容は変わらない
    first.resolve("古い結果");
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: "ready", data: "新しい結果" });
  });

  it("アンマウントで進行中フェッチを abort し、結果を破棄する", async () => {
    const pending = deferred<string>();
    const signals: AbortSignal[] = [];
    const fetchFn = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockImplementation((signal) => {
        signals.push(signal);
        return pending.promise;
      });
    const { unmount } = renderHook(() => useApiQuery(fetchFn));

    unmount();
    expect(signals[0]?.aborted).toBe(true);

    // アンマウント後の解決で setState されない（React の警告・エラーが出ないことを含めて検証）
    pending.resolve("late");
    await Promise.resolve();
  });

  it("fetchFn の参照が変わると再取得する（検索条件変更のパス）", async () => {
    const fetchA = vi.fn().mockResolvedValue("A");
    const fetchB = vi.fn().mockResolvedValue("B");
    const { result, rerender } = renderHook(({ fn }) => useApiQuery(fn), {
      initialProps: { fn: fetchA },
    });

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: "ready", data: "A" });
    });

    rerender({ fn: fetchB });
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: "ready", data: "B" });
    });
  });
});
