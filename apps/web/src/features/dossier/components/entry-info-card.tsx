"use client";

// S5 の企業基本情報 + ステータス + 深掘り状態行（ui-spec 2.3 S5 ワイヤー上段）。
// 業種・従業員数・地域は外部由来のため SafeText、ドメインは ExternalLink（ui-spec 7 章 — U8）。
import { useState } from "react";
import type { DeepDiveJob, EntryStatus, ListEntry } from "@is-reach/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { Modal } from "@/components/ui/modal";
import { SafeText } from "@/components/ui/safe-text";
import { Select } from "@/components/ui/select";
import { formatDateTimeJst } from "@/lib/format/date";
import { DEEP_DIVE_JOB_STATE_LABELS } from "@/lib/labels/deep-dive";
import { ENTRY_STATUS_LABELS } from "@/lib/labels/entry-status";
import { isDeepDiveRunning } from "../hooks/use-deep-dive-job";

const STATUS_OPTIONS = Object.entries(ENTRY_STATUS_LABELS).map(([value, { label }]) => ({
  value,
  label,
}));

export interface EntryInfoCardProps {
  entry: ListEntry;
  onStatusChange: (status: EntryStatus) => void;
  statusPending: boolean;
  /** 深掘りジョブ（未実行・取得前は null） */
  job: DeepDiveJob | null;
  deepDiveActionPending: boolean;
  /** 再実行（新規ジョブ投入）。確認モーダルは本コンポーネントが挟む */
  onRunDeepDive: () => void;
  /** failed からのリトライ */
  onRetryDeepDive: () => void;
}

export function EntryInfoCard({
  entry,
  onStatusChange,
  statusPending,
  job,
  deepDiveActionPending,
  onRunDeepDive,
  onRetryDeepDive,
}: EntryInfoCardProps) {
  const [confirmRerun, setConfirmRerun] = useState(false);
  const { company } = entry;
  const stateLabel = job === null ? null : DEEP_DIVE_JOB_STATE_LABELS[job.state];

  return (
    <section className="rounded-lg border border-neutral-200 bg-neutral-0 p-4 shadow-sm">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm lg:grid-cols-4">
        <InfoItem label="業種" value={company.industry} />
        <InfoItem label="従業員数" value={company.employeeRange} />
        <InfoItem label="地域" value={company.region} />
        <div>
          <dt className="text-xs font-medium text-neutral-500">ドメイン</dt>
          <dd className="mt-0.5">
            {company.domain !== null && company.domain !== "" ? (
              <ExternalLink href={toHttpUrl(company.domain)} className="text-sm" />
            ) : (
              <span className="text-neutral-400">—</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-neutral-200 pt-3">
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <span className="text-xs font-medium text-neutral-500">ステータス</span>
          <Select
            aria-label="ステータス"
            options={STATUS_OPTIONS}
            value={entry.status}
            disabled={statusPending}
            onChange={(event) => {
              onStatusChange(event.currentTarget.value as EntryStatus);
            }}
            className="w-36"
          />
        </label>

        <div className="flex items-center gap-2 text-sm text-neutral-700">
          <span className="text-xs font-medium text-neutral-500">深掘り</span>
          {job === null || stateLabel === null ? (
            <span className="text-neutral-500">未実行</span>
          ) : (
            <>
              <Badge tone={stateLabel.tone}>{stateLabel.label}</Badge>
              {job.state === "done" ? (
                <span className="text-xs text-neutral-500">{formatDateTimeJst(job.updatedAt)}</span>
              ) : null}
            </>
          )}
          {job !== null && job.state === "failed" ? (
            <Button
              size="sm"
              loading={deepDiveActionPending}
              onClick={onRetryDeepDive}
              aria-label="深掘りを再実行"
            >
              再実行
            </Button>
          ) : job !== null && !isDeepDiveRunning(job.state) ? (
            <Button
              size="sm"
              loading={deepDiveActionPending}
              onClick={() => setConfirmRerun(true)}
              aria-label="深掘りを再実行"
            >
              再実行
            </Button>
          ) : null}
        </div>
      </div>

      <Modal
        open={confirmRerun}
        onClose={() => setConfirmRerun(false)}
        title="深掘りを再実行しますか？"
        footer={
          <>
            <Button onClick={() => setConfirmRerun(false)}>キャンセル</Button>
            <Button
              variant="primary"
              loading={deepDiveActionPending}
              onClick={() => {
                setConfirmRerun(false);
                onRunDeepDive();
              }}
            >
              再実行する
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          公開情報の収集と分析をやり直します。完了するとドシエが新しい内容に更新されます。
        </p>
      </Modal>
    </section>
  );
}

function InfoItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-neutral-800">
        {value !== null && value !== "" ? (
          <SafeText text={value} maxLines={2} />
        ) : (
          <span className="text-neutral-400">—</span>
        )}
      </dd>
    </div>
  );
}

/** ドメイン文字列を http(s) URL へ（スキーム付きはそのまま。検証は ExternalLink 側で行う） */
function toHttpUrl(domain: string): string {
  return domain.includes("://") ? domain : `https://${domain}`;
}
