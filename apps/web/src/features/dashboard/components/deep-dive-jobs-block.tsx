"use client";

// S1 ブロック 2: 進行中の深掘りジョブ（直近リストのエントリから実行中ジョブを列挙）
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { SafeText } from "@/components/ui/safe-text";
import type { ApiQueryState } from "@/lib/api/use-api-query";
import { DEEP_DIVE_JOB_STATE_LABELS } from "@/lib/labels/deep-dive";
import type { DashboardActivity } from "../api";
import { BlockSkeleton } from "./block-skeleton";
import { NoListsEmptyState } from "./recent-lists-block";

export interface DeepDiveJobsBlockProps {
  state: ApiQueryState<DashboardActivity>;
  onRetry: () => void;
}

export function DeepDiveJobsBlock({ state, onRetry }: DeepDiveJobsBlockProps) {
  return (
    <Card title="進行中の深掘りジョブ">
      {state.status === "loading" ? <BlockSkeleton rows={3} /> : null}
      {state.status === "error" ? (
        <ErrorState requestId={state.requestId} onRetry={onRetry} />
      ) : null}
      {state.status === "ready" ? (
        state.data.totalListCount === 0 ? (
          <NoListsEmptyState />
        ) : (
          <div>
            {state.data.runningJobs.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-500">
                実行中の深掘りジョブはありません
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {state.data.runningJobs.map((item) => {
                  const label = DEEP_DIVE_JOB_STATE_LABELS[item.job.state];
                  return (
                    <li key={item.job.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {/* 企業名はスクレイピング（外部）由来のため SafeText（ui-spec 7 章 — U8） */}
                        <SafeText
                          text={item.entry.company.name}
                          maxLines={1}
                          className="min-w-0 text-sm font-medium text-neutral-800"
                        />
                        <Badge tone={label.tone}>{label.label}</Badge>
                      </div>
                      <Link
                        href={`/lists/${item.listId}`}
                        className="shrink-0 text-sm font-medium text-primary hover:text-primary-hover"
                      >
                        リストを開く
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-neutral-400">
              直近 {state.data.scannedListCount} 件のリストのみを対象にした簡易表示です
              {state.data.skippedJobLookups > 0
                ? `（ほか ${state.data.skippedJobLookups} 件のジョブは状態未確認）`
                : ""}
            </p>
          </div>
        )
      ) : null}
    </Card>
  );
}
