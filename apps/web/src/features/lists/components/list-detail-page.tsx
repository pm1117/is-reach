"use client";

// S4 リスト詳細 — 業務のハブ画面（ui-spec 2.3 — 要件 F2 / F5）。
// エントリテーブル（選択・マッチ根拠・深掘り状態・ステータス・更新日時）+ 一括深掘り実行。
// 実行中ジョブがある間は 10 秒間隔でポーリングし、全件終了で停止する（ui-spec 4.5 / E13）。
import {
  entryStatusSchema,
  type DeepDiveJob,
  type EntryStatus,
  type ListEntry,
  type Paginated,
} from "@is-reach/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { SafeText } from "@/components/ui/safe-text";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { getBrowserApiClient } from "@/lib/api/browser";
import { useApiQuery } from "@/lib/api/use-api-query";
import { PAGE_SIZE } from "@/lib/config/pagination";
import { POLLING_INTERVAL_MS } from "@/lib/config/polling";
import { formatDateTimeJst } from "@/lib/format/date";
import { useJobPolling } from "@/lib/jobs/use-job-polling";
import { ENTRY_STATUS_LABELS } from "@/lib/labels/entry-status";
import {
  createDeepDiveJobs,
  fetchCompanyList,
  fetchDeepDiveJob,
  fetchListEntries,
  retryDeepDiveJob,
} from "../api";
import { describeActionError } from "../error-message";
import { DeepDiveStatusCell, type DeepDiveJobSlot } from "./deep-dive-status-cell";
import { EntryStatusSelect } from "./entry-status-select";
import { MatchEvidenceCell } from "./match-evidence-cell";

/** 実行中とみなすジョブ状態（basic-design 4.3 の状態機械） */
const ACTIVE_JOB_STATES: ReadonlySet<DeepDiveJob["state"]> = new Set([
  "queued",
  "collecting",
  "analyzing",
]);

/** 深掘り状態の絞り込み（クライアント側 — ジョブ状態は行単位取得のため） */
const DEEP_DIVE_FILTER_OPTIONS = [
  { value: "all", label: "全て" },
  { value: "none", label: "未実行" },
  { value: "running", label: "実行中" },
  { value: "done", label: "完了" },
  { value: "failed", label: "失敗" },
] as const;
type DeepDiveFilter = (typeof DEEP_DIVE_FILTER_OPTIONS)[number]["value"];
type DeepDiveCategory = Exclude<DeepDiveFilter, "all"> | "unknown";

const STATUS_FILTER_OPTIONS = entryStatusSchema.options.map((value) => ({
  value,
  label: ENTRY_STATUS_LABELS[value].label,
}));

export interface ListDetailPageProps {
  listId: string;
}

export function ListDetailPage({ listId }: ListDetailPageProps) {
  const client = getBrowserApiClient();
  const { showToast } = useToast();

  const listQuery = useApiQuery(
    useCallback(
      (signal: AbortSignal) => fetchCompanyList(client, listId, signal),
      [client, listId],
    ),
  );

  const [statusFilter, setStatusFilter] = useState<EntryStatus | "">("");
  const [deepDiveFilter, setDeepDiveFilter] = useState<DeepDiveFilter>("all");
  const [page, setPage] = useState(1);
  const offset = (page - 1) * PAGE_SIZE;

  const entriesQuery = useApiQuery(
    useCallback(
      (signal: AbortSignal) =>
        fetchListEntries(
          client,
          listId,
          statusFilter === ""
            ? { limit: PAGE_SIZE, offset }
            : { limit: PAGE_SIZE, offset, status: statusFilter },
          signal,
        ),
      [client, listId, statusFilter, offset],
    ),
  );
  const readyEntries = entriesQuery.state.status === "ready" ? entriesQuery.state.data : null;
  // 再取得中も直前の一覧を表示し続ける（stale-while-revalidate）。ポーリング起因の
  // reload のたびにテーブル全体が LoadingState へ置き換わるのを防ぐ（ui-spec 4.5:
  // ポーリングは既存表示を壊さない）
  const [entriesData, setEntriesData] = useState<Paginated<ListEntry> | null>(null);
  useEffect(() => {
    if (readyEntries !== null) {
      setEntriesData(readyEntries);
    }
  }, [readyEntries]);

  // 総件数が縮んだ場合（絞り込み・削除・再取得）にページ番号を範囲内へ戻す
  useEffect(() => {
    if (entriesData === null) return;
    const pageCount = Math.max(1, Math.ceil(entriesData.total / PAGE_SIZE));
    setPage((current) => Math.min(current, pageCount));
  }, [entriesData]);

  // ジョブ状態（jobId → slot）。
  // 【仮置き・既知の API 制約】ジョブ状態の一括取得エンドポイントがないため、
  // 表示中エントリの latestDeepDiveJobId を GET /deep-dive-jobs/:jobId で件数分
  // 並列取得する（1 ページ最大 50 リクエスト）。一括取得 API の追加は PR 計画への
  // 申し送り事項とする。
  const [jobsById, setJobsById] = useState<ReadonlyMap<string, DeepDiveJobSlot>>(new Map());
  // PATCH /entries の応答での行差し替え（エントリ一覧の再取得なしに反映する）
  const [entryOverrides, setEntryOverrides] = useState<ReadonlyMap<string, ListEntry>>(new Map());
  // POST /deep-dive-jobs 202 応答の即時反映（entries 再取得前に深掘り状態列を更新する）
  const [jobIdByEntry, setJobIdByEntry] = useState<ReadonlyMap<string, string>>(new Map());
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [retryingJobIds, setRetryingJobIds] = useState<ReadonlySet<string>>(new Set());
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const mergeJobs = useCallback((jobs: ReadonlyArray<DeepDiveJob>) => {
    setJobsById((current) => {
      const next = new Map(current);
      for (const job of jobs) {
        next.set(job.id, { kind: "ready", job });
      }
      return next;
    });
  }, []);

  // エントリ一覧が更新されたら: ローカル上書きを破棄し、選択を現ページの実在行に絞り、
  // 参照されているジョブ状態を取得し直す
  useEffect(() => {
    setEntryOverrides(new Map());
    setJobIdByEntry(new Map());
    if (entriesData === null) return;
    const presentIds = new Set(entriesData.items.map((entry) => entry.id));
    setSelectedIds((current) => new Set([...current].filter((id) => presentIds.has(id))));

    const jobIds = [
      ...new Set(
        entriesData.items
          .map((entry) => entry.latestDeepDiveJobId)
          .filter((jobId): jobId is string => jobId !== null),
      ),
    ];
    if (jobIds.length === 0) return;

    let active = true;
    const controller = new AbortController();
    void (async () => {
      const results = await Promise.allSettled(
        jobIds.map((jobId) => fetchDeepDiveJob(client, jobId, controller.signal)),
      );
      if (!active) return;
      setJobsById((current) => {
        const next = new Map(current);
        results.forEach((result, index) => {
          const jobId = jobIds[index];
          if (jobId === undefined) return;
          if (result.status === "fulfilled") {
            next.set(jobId, { kind: "ready", job: result.value });
          } else {
            next.set(jobId, { kind: "error" });
          }
        });
        return next;
      });
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [entriesData, client]);

  const effectiveEntries = useMemo(
    () =>
      (entriesData?.items ?? []).map((entry) => ({
        entry: entryOverrides.get(entry.id) ?? entry,
        jobId: jobIdByEntry.get(entry.id) ?? entry.latestDeepDiveJobId,
      })),
    [entriesData, entryOverrides, jobIdByEntry],
  );

  const categoryOf = useCallback(
    (jobId: string | null): DeepDiveCategory => {
      if (jobId === null) return "none";
      const slot = jobsById.get(jobId);
      if (slot === undefined || slot.kind === "error") return "unknown";
      if (ACTIVE_JOB_STATES.has(slot.job.state)) return "running";
      return slot.job.state === "done" ? "done" : "failed";
    },
    [jobsById],
  );

  // ポーリング対象: 実行中（queued/collecting/analyzing）のジョブに加え、状態取得に
  // 失敗したジョブも含める（実行中かもしれないのに取得失敗のまま対象から外すと
  // 永久に更新されなくなるため、次周期で再試行する — ui-spec 4.5）
  const pollTargetJobIds = useMemo(
    () =>
      [
        ...new Set(
          effectiveEntries
            .map(({ jobId }) => jobId)
            .filter((jobId): jobId is string => jobId !== null),
        ),
      ].filter((jobId) => {
        const slot = jobsById.get(jobId);
        if (slot === undefined) return false; // 初回取得中（entriesData 変化時の effect が担当）
        return slot.kind === "error" || ACTIVE_JOB_STATES.has(slot.job.state);
      }),
    [effectiveEntries, jobsById],
  );

  // ポーリング（10 秒 — E13）。実行中ジョブの状態を再取得し、done への遷移があれば
  // エントリ一覧も再取得する（latestDeepDiveJobId・updatedAt の反映）。
  // 全ジョブ終了で active=false になり自動停止する。
  useJobPolling({
    poll: async (signal) => {
      if (pollTargetJobIds.length === 0) return;
      const results = await Promise.allSettled(
        pollTargetJobIds.map((jobId) => fetchDeepDiveJob(client, jobId, signal)),
      );
      const jobs = results
        .filter(
          (result): result is PromiseFulfilledResult<DeepDiveJob> => result.status === "fulfilled",
        )
        .map((result) => result.value);
      mergeJobs(jobs);
      if (jobs.some((job) => job.state === "done")) {
        entriesQuery.reload();
      }
      // 一部失敗は成功分を反映した上で useJobPolling の lastError に載せ、次周期で再試行する
      const rejected = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (rejected !== undefined) {
        throw rejected.reason;
      }
    },
    intervalMs: POLLING_INTERVAL_MS.deepDiveList,
    active: pollTargetJobIds.length > 0,
  });

  const runningCount = useMemo(
    () => effectiveEntries.filter(({ jobId }) => categoryOf(jobId) === "running").length,
    [effectiveEntries, categoryOf],
  );

  const visibleEntries = useMemo(
    () =>
      deepDiveFilter === "all"
        ? effectiveEntries
        : effectiveEntries.filter(({ jobId }) => categoryOf(jobId) === deepDiveFilter),
    [effectiveEntries, deepDiveFilter, categoryOf],
  );

  // 深掘り済み（done）・実行中の選択行数（実行確認モーダルの注記用 — ui-spec 2.3）
  const rerunCount = useMemo(
    () =>
      effectiveEntries.filter(({ entry, jobId }) => {
        if (!selectedIds.has(entry.id)) return false;
        const category = categoryOf(jobId);
        return category === "running" || category === "done";
      }).length,
    [effectiveEntries, selectedIds, categoryOf],
  );

  function toggleEntry(entryId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }

  function toggleAll() {
    const allIds = visibleEntries.map(({ entry }) => entry.id);
    setSelectedIds((current) =>
      allIds.every((id) => current.has(id)) ? new Set() : new Set(allIds),
    );
  }

  async function handleRunDeepDive() {
    setRunning(true);
    try {
      const response = await createDeepDiveJobs(client, [...selectedIds]);
      // 202 応答の jobs で深掘り状態列を即時反映する
      mergeJobs(response.jobs);
      setJobIdByEntry((current) => {
        const next = new Map(current);
        for (const job of response.jobs) {
          next.set(job.listEntryId, job.id);
        }
        return next;
      });
      setSelectedIds(new Set());
      setRunModalOpen(false);
      showToast({ tone: "success", message: `深掘りを開始しました（${response.jobs.length} 社）` });
    } catch (error) {
      showToast({
        tone: "danger",
        message: describeActionError("深掘りの実行に失敗しました", error),
      });
    } finally {
      setRunning(false);
    }
  }

  async function handleRetry(jobId: string) {
    setRetryingJobIds((current) => new Set(current).add(jobId));
    try {
      const job = await retryDeepDiveJob(client, jobId);
      mergeJobs([job]);
    } catch (error) {
      showToast({
        tone: "danger",
        message: describeActionError("再実行に失敗しました", error),
      });
    } finally {
      setRetryingJobIds((current) => {
        const next = new Set(current);
        next.delete(jobId);
        return next;
      });
    }
  }

  if (listQuery.state.status === "loading") {
    return <LoadingState label="リストを読み込んでいます…" />;
  }
  if (listQuery.state.status === "error") {
    return (
      <ErrorState
        title="リストの読み込みに失敗しました"
        requestId={listQuery.state.requestId}
        onRetry={listQuery.reload}
      />
    );
  }
  const list = listQuery.state.data;
  const allVisibleSelected =
    visibleEntries.length > 0 && visibleEntries.every(({ entry }) => selectedIds.has(entry.id));

  return (
    <div>
      {/* パンくず（リンク化は feature 層で行う — PR6a の PageHeader は文字列のみのため自前で描画） */}
      <nav aria-label="パンくず" className="mb-1 text-xs text-neutral-500">
        <Link href="/lists" className="hover:text-neutral-700 hover:underline">
          リスト
        </Link>
        <span aria-hidden="true"> &gt; </span>
        <span>{list.name}</span>
      </nav>
      <PageHeader
        title={list.name}
        actions={
          <Button
            variant="primary"
            disabled={selectedIds.size === 0}
            onClick={() => setRunModalOpen(true)}
          >
            選択した企業を深掘り ({selectedIds.size} 社)
          </Button>
        }
      />

      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="flex gap-3">
          <Select
            label="ステータス"
            value={statusFilter}
            placeholder="全て"
            options={STATUS_FILTER_OPTIONS}
            onChange={(event) => {
              const parsed = entryStatusSchema.safeParse(event.target.value);
              setStatusFilter(parsed.success ? parsed.data : "");
              setPage(1);
            }}
            className="w-36"
          />
          <Select
            label="深掘り状態"
            value={deepDiveFilter}
            options={DEEP_DIVE_FILTER_OPTIONS.map(({ value, label }) => ({ value, label }))}
            onChange={(event) => {
              const value = DEEP_DIVE_FILTER_OPTIONS.find(
                (option) => option.value === event.target.value,
              );
              setDeepDiveFilter(value?.value ?? "all");
            }}
            className="w-36"
          />
        </div>
        {runningCount > 0 ? (
          <p className="text-xs font-medium text-primary">深掘り実行中: {runningCount} 社</p>
        ) : null}
      </div>

      {entriesQuery.state.status === "error" ? (
        <ErrorState
          title="企業一覧の読み込みに失敗しました"
          requestId={entriesQuery.state.requestId}
          onRetry={entriesQuery.reload}
        />
      ) : entriesData === null ? (
        <LoadingState label="企業を読み込んでいます…" />
      ) : entriesData.total === 0 && statusFilter === "" ? (
        <EmptyState title="このリストに企業がありません" />
      ) : visibleEntries.length === 0 ? (
        <EmptyState
          title="条件に一致する企業がありません"
          description="絞り込みを変更してください"
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell className="w-10">
                  <Checkbox
                    aria-label="すべての企業を選択"
                    checked={allVisibleSelected}
                    indeterminate={selectedIds.size > 0 && !allVisibleSelected}
                    onChange={toggleAll}
                  />
                </TableHeaderCell>
                <TableHeaderCell>企業名</TableHeaderCell>
                <TableHeaderCell>マッチ根拠</TableHeaderCell>
                <TableHeaderCell>深掘り状態</TableHeaderCell>
                <TableHeaderCell className="w-36">ステータス</TableHeaderCell>
                <TableHeaderCell className="w-44">更新日時</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleEntries.map(({ entry, jobId }) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <Checkbox
                      aria-label={`${entry.company.name} を選択`}
                      checked={selectedIds.has(entry.id)}
                      onChange={() => toggleEntry(entry.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {/* 企業名はスクレイピング由来 = 信頼境界外。SafeText 経由で表示する */}
                    <Link
                      href={`/lists/${encodeURIComponent(listId)}/entries/${entry.id}`}
                      className="text-primary hover:text-primary-hover hover:underline"
                    >
                      <SafeText text={entry.company.name} />
                    </Link>
                  </TableCell>
                  <TableCell>
                    <MatchEvidenceCell signals={entry.matchEvidence} />
                  </TableCell>
                  <TableCell>
                    <DeepDiveStatusCell
                      jobId={jobId}
                      slot={jobId === null ? undefined : jobsById.get(jobId)}
                      retrying={jobId !== null && retryingJobIds.has(jobId)}
                      onRetry={(id) => void handleRetry(id)}
                    />
                  </TableCell>
                  <TableCell>
                    <EntryStatusSelect
                      entry={entry}
                      onUpdated={(updated) =>
                        setEntryOverrides((current) => new Map(current).set(updated.id, updated))
                      }
                    />
                  </TableCell>
                  <TableCell className="text-neutral-500">
                    {formatDateTimeJst(entry.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            totalItems={entriesData.total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      )}

      <Modal
        open={runModalOpen}
        onClose={() => setRunModalOpen(false)}
        title="深掘りを実行"
        footer={
          <>
            <Button onClick={() => setRunModalOpen(false)} disabled={running}>
              キャンセル
            </Button>
            <Button variant="primary" loading={running} onClick={() => void handleRunDeepDive()}>
              実行する
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-600">
          選択した {selectedIds.size} 社の深掘り（公開情報の収集・分析）を実行します。
        </p>
        {rerunCount > 0 ? (
          <p className="mt-2 text-sm text-warning">
            うち {rerunCount}{" "}
            社は深掘り済みまたは実行中です。再実行すると前回の結果は上書きされます。
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
