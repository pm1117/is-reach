"use client";

// 深掘り状態列（ui-spec 4.5 の表に準拠 — 決定）。
// queued: バッジ + スピナー / collecting・analyzing: バッジ + 不定プログレスバー + フェーズ文言 /
// done: バッジ + 完了日時 / failed: danger バッジ + 「再実行」+ 失敗理由の要約。
// 失敗理由（error.message）はジョブ由来 = 信頼境界外のため SafeText で表示する（ui-spec 7 章）。
import type { DeepDiveJob } from "@is-reach/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SafeText } from "@/components/ui/safe-text";
import { Spinner } from "@/components/ui/spinner";
import { DEEP_DIVE_JOB_STATE_LABELS } from "@/lib/labels/deep-dive";
import { formatDateTimeJst } from "@/lib/format/date";

/** ジョブ状態の取得結果（個別 GET のため取得失敗が行単位で起こりうる） */
export type DeepDiveJobSlot = { kind: "ready"; job: DeepDiveJob } | { kind: "error" };

export interface DeepDiveStatusCellProps {
  /** entry.latestDeepDiveJobId（null = 未実行） */
  jobId: string | null;
  /** ジョブ状態（undefined = 取得中） */
  slot: DeepDiveJobSlot | undefined;
  retrying: boolean;
  onRetry: (jobId: string) => void;
}

/** collecting / analyzing のフェーズ文言（ui-spec 4.5 — 決定） */
const PHASE_MESSAGES = {
  collecting: "公開情報を収集しています",
  analyzing: "収集した情報を分析しています",
} as const;

export function DeepDiveStatusCell({ jobId, slot, retrying, onRetry }: DeepDiveStatusCellProps) {
  if (jobId === null) {
    return <Badge tone="neutral">未実行</Badge>;
  }
  if (slot === undefined) {
    return <span className="text-xs text-neutral-500">状態を取得しています…</span>;
  }
  if (slot.kind === "error") {
    return <span className="text-xs text-neutral-500">状態を取得できませんでした</span>;
  }

  const { job } = slot;
  const { label, tone } = DEEP_DIVE_JOB_STATE_LABELS[job.state];

  switch (job.state) {
    case "queued":
      return (
        <span className="inline-flex items-center gap-1.5">
          <Badge tone={tone}>{label}</Badge>
          <Spinner size="sm" className="text-neutral-400" />
        </span>
      );
    case "collecting":
    case "analyzing": {
      const phase = PHASE_MESSAGES[job.state];
      return (
        <div className="flex w-44 flex-col gap-1">
          <div>
            <Badge tone={tone}>{label}</Badge>
          </div>
          <ProgressBar label={phase} />
          <span className="text-xs text-neutral-500">{phase}</span>
        </div>
      );
    }
    case "done":
      return (
        <div className="flex flex-col gap-0.5">
          <div>
            <Badge tone={tone}>{label}</Badge>
          </div>
          <span className="text-xs text-neutral-500">{formatDateTimeJst(job.updatedAt)}</span>
        </div>
      );
    case "failed":
      return (
        <div className="flex max-w-56 flex-col gap-1">
          <div className="flex items-center gap-2">
            <Badge tone={tone}>{label}</Badge>
            <Button size="sm" loading={retrying} onClick={() => onRetry(job.id)}>
              再実行
            </Button>
          </div>
          {job.error !== null ? (
            <SafeText text={job.error.message} maxLines={2} className="text-xs text-neutral-600" />
          ) : null}
        </div>
      );
  }
}
