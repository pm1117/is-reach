"use client";

// S5 の深掘りジョブ状態管理フック。
// - entry.latestDeepDiveJobId を起点にジョブを取得し、実行中は 3 秒ポーリング（E13）
// - done へ遷移したら onCompleted（ドシエ再取得）を 1 回呼ぶ
// - 再実行（POST /deep-dive-jobs）・リトライ（POST /deep-dive-jobs/:jobId/retry）を提供する
import { useCallback, useEffect, useRef, useState } from "react";
import type { DeepDiveJob, DeepDiveJobState } from "@is-reach/shared";
import { getBrowserApiClient } from "@/lib/api/browser";
import { ApiClientError } from "@/lib/api/client";
import { POLLING_INTERVAL_MS } from "@/lib/config/polling";
import { useJobPolling } from "@/lib/jobs/use-job-polling";
import { createDeepDiveJob, fetchDeepDiveJob, retryDeepDiveJob } from "../api";

const RUNNING_STATES: ReadonlyArray<DeepDiveJobState> = ["queued", "collecting", "analyzing"];

export function isDeepDiveRunning(state: DeepDiveJobState): boolean {
  return RUNNING_STATES.includes(state);
}

export interface UseDeepDiveJobResult {
  /** 現在のジョブ（未実行・初回取得前は null） */
  job: DeepDiveJob | null;
  /** ジョブ初回取得の失敗（ポーリング中の一時失敗は含めない） */
  loadError: { requestId: string | null } | null;
  /** 実行中（queued / collecting / analyzing）か */
  running: boolean;
  /** run / retry の実行中フラグ（ボタンのスピナー表示用） */
  actionPending: boolean;
  /** 新規実行（再実行を含む — POST /deep-dive-jobs）。失敗時は throw する */
  run: () => Promise<void>;
  /** failed からのリトライ（POST /deep-dive-jobs/:jobId/retry）。失敗時は throw する */
  retry: () => Promise<void>;
}

export function useDeepDiveJob({
  entryId,
  initialJobId,
  onCompleted,
}: {
  entryId: string;
  /** entry.latestDeepDiveJobId（未実行は null） */
  initialJobId: string | null;
  /** done へ遷移したら呼ばれる（ドシエ再取得用） */
  onCompleted: () => void;
}): UseDeepDiveJobResult {
  const [jobId, setJobId] = useState<string | null>(initialJobId);
  const [job, setJob] = useState<DeepDiveJob | null>(null);
  const [loadError, setLoadError] = useState<{ requestId: string | null } | null>(null);
  const [actionPending, setActionPending] = useState(false);

  // entry 再取得で latestDeepDiveJobId が変わった場合に追随する（ローカルで run 済みなら run 側が優先）
  const localJobIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (localJobIdRef.current === null && initialJobId !== null) {
      setJobId(initialJobId);
    }
  }, [initialJobId]);

  // ジョブの初回取得（jobId が決まるたび）
  useEffect(() => {
    if (jobId === null) {
      return;
    }
    let active = true;
    const controller = new AbortController();
    setLoadError(null);
    void (async () => {
      try {
        const fetched = await fetchDeepDiveJob(getBrowserApiClient(), jobId, controller.signal);
        if (active) {
          setJob(fetched);
        }
      } catch (error) {
        if (active) {
          setLoadError({
            requestId: error instanceof ApiClientError ? error.requestId : null,
          });
        }
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [jobId]);

  const running = job !== null && isDeepDiveRunning(job.state);

  useJobPolling({
    poll: useCallback(
      async (signal: AbortSignal) => {
        if (jobId === null) {
          return;
        }
        setJob(await fetchDeepDiveJob(getBrowserApiClient(), jobId, signal));
      },
      [jobId],
    ),
    intervalMs: POLLING_INTERVAL_MS.deepDiveDetail,
    active: running,
  });

  // done への遷移を検知してドシエを再取得させる
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);
  const prevStateRef = useRef<DeepDiveJobState | null>(null);
  useEffect(() => {
    const state = job?.state ?? null;
    if (state === "done" && prevStateRef.current !== null && prevStateRef.current !== "done") {
      onCompletedRef.current();
    }
    prevStateRef.current = state;
  }, [job?.state]);

  const run = useCallback(async () => {
    setActionPending(true);
    try {
      const response = await createDeepDiveJob(getBrowserApiClient(), entryId);
      const created = response.jobs[0];
      if (created !== undefined) {
        localJobIdRef.current = created.id;
        setJob(created);
        setJobId(created.id);
      }
    } finally {
      setActionPending(false);
    }
  }, [entryId]);

  const retry = useCallback(async () => {
    if (jobId === null) {
      return;
    }
    setActionPending(true);
    try {
      const retried = await retryDeepDiveJob(getBrowserApiClient(), jobId);
      localJobIdRef.current = retried.id;
      setJob(retried);
    } finally {
      setActionPending(false);
    }
  }, [jobId]);

  return { job, loadError, running, actionPending, run, retry };
}
