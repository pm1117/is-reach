"use client";

// S1 ブロック 3: ステータス集計（未着手 / 生成済み / 送信済み / 返信あり の件数）
import { entryStatusSchema, type EntryStatus } from "@is-reach/shared";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import type { ApiQueryState } from "@/lib/api/use-api-query";
import { ENTRY_STATUS_LABELS } from "@/lib/labels/entry-status";
import { ACTIVITY_ENTRIES_LIMIT, type DashboardActivity } from "../api";
import { BlockSkeleton } from "./block-skeleton";
import { NoListsEmptyState } from "./recent-lists-block";

export interface StatusSummaryBlockProps {
  state: ApiQueryState<DashboardActivity>;
  onRetry: () => void;
}

function countByStatus(data: DashboardActivity): Record<EntryStatus, number> {
  const counts: Record<EntryStatus, number> = {
    not_started: 0,
    generated: 0,
    sent: 0,
    replied: 0,
  };
  for (const item of data.entries) {
    counts[item.entry.status] += 1;
  }
  return counts;
}

function StatusSummaryContent({ data }: { data: DashboardActivity }) {
  const counts = countByStatus(data);
  return (
    <div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {entryStatusSchema.options.map((status) => (
          <div
            key={status}
            className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2"
          >
            <dt className="text-xs text-neutral-500">{ENTRY_STATUS_LABELS[status].label}</dt>
            <dd className="text-xl font-semibold text-neutral-900">{counts[status]}</dd>
          </div>
        ))}
      </dl>
      {/* 集計対象が直近リスト + 取得上限に限られることの注記（簡易版の明示） */}
      <p className="mt-3 text-xs text-neutral-400">
        集計対象は直近 {data.scannedListCount} 件のリストのエントリ（各リスト最大{" "}
        {ACTIVITY_ENTRIES_LIMIT} 件）のみです
      </p>
    </div>
  );
}

export function StatusSummaryBlock({ state, onRetry }: StatusSummaryBlockProps) {
  return (
    <Card title="ステータス集計">
      {state.status === "loading" ? <BlockSkeleton rows={2} /> : null}
      {state.status === "error" ? (
        <ErrorState requestId={state.requestId} onRetry={onRetry} />
      ) : null}
      {state.status === "ready" ? (
        state.data.totalListCount === 0 ? (
          <NoListsEmptyState />
        ) : (
          <StatusSummaryContent data={state.data} />
        )
      ) : null}
    </Card>
  );
}
