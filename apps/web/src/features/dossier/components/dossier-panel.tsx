"use client";

// S5 の主領域（左）: ドシエ表示（要件 F3）。
// - 未生成（404）は空状態 + 「深掘りを実行」中央ボタン（ui-spec 4.2）
// - 実行中はフェーズ表示（ui-spec 4.5 — パーセント表示禁止）
// - failed は失敗理由（外部由来 → SafeText）+ 再実行
import type { DeepDiveJob, Dossier } from "@is-reach/shared";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SafeText } from "@/components/ui/safe-text";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiQueryState } from "@/lib/api/use-api-query";
import { isDeepDiveRunning } from "../hooks/use-deep-dive-job";
import { summarizeWarningCodes } from "@/lib/labels/warning";
import { DeepDiveProgress } from "./deep-dive-progress";
import { DossierSectionItem } from "./dossier-section-item";

export interface DossierPanelProps {
  dossierState: ApiQueryState<Dossier | null>;
  reloadDossier: () => void;
  job: DeepDiveJob | null;
  deepDiveActionPending: boolean;
  /** 深掘りの新規実行（空状態の中央ボタン用） */
  onRunDeepDive: () => void;
  /** failed からのリトライ */
  onRetryDeepDive: () => void;
}

export function DossierPanel({
  dossierState,
  reloadDossier,
  job,
  deepDiveActionPending,
  onRunDeepDive,
  onRetryDeepDive,
}: DossierPanelProps) {
  if (dossierState.status === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-label="ドシエを読み込み中">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (dossierState.status === "error") {
    return (
      <ErrorState
        title="ドシエの読み込みに失敗しました"
        requestId={dossierState.requestId}
        onRetry={reloadDossier}
      />
    );
  }

  const dossier = dossierState.data;
  const running = job !== null && isDeepDiveRunning(job.state);

  return (
    <div className="flex flex-col gap-4">
      {running && job !== null ? <DeepDiveProgress state={job.state} /> : null}

      {job !== null && job.state === "failed" ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-danger bg-danger-subtle p-4"
        >
          <p className="text-sm font-medium text-danger">深掘りに失敗しました</p>
          {job.error !== null ? (
            <SafeText text={job.error.message} maxLines={4} className="text-xs text-neutral-700" />
          ) : null}
          <Button
            size="sm"
            loading={deepDiveActionPending}
            onClick={onRetryDeepDive}
            className="self-start"
          >
            再実行
          </Button>
        </div>
      ) : null}

      {dossier === null ? (
        !running && (job === null || job.state !== "failed") ? (
          <EmptyState
            title="まだ深掘りが実行されていません"
            description="深掘りを実行すると、公開情報から事業サマリ・推定課題・接続点を分析します"
            action={
              <Button variant="primary" loading={deepDiveActionPending} onClick={onRunDeepDive}>
                深掘りを実行
              </Button>
            }
          />
        ) : null
      ) : (
        <DossierContent dossier={dossier} />
      )}
    </div>
  );
}

function DossierContent({ dossier }: { dossier: Dossier }) {
  return (
    <div className="flex flex-col gap-5">
      {dossier.warnings.length > 0 ? (
        <div
          role="alert"
          className="rounded-md border border-warning bg-warning-subtle p-3 text-sm text-warning-hover"
        >
          このドシエは自動検証で警告が検出されました:{" "}
          {summarizeWarningCodes(dossier.warnings.map((warning) => warning.code))}
          。内容を確認のうえ利用してください。
        </div>
      ) : null}

      <DossierGroup title="事業サマリ">
        <DossierSectionItem section={dossier.businessSummary} />
      </DossierGroup>

      <DossierGroup title="推定課題">
        {dossier.inferredIssues.length === 0 ? (
          <p className="text-sm text-neutral-500">推定課題はありません</p>
        ) : (
          dossier.inferredIssues.map((section, index) => (
            <DossierSectionItem key={index} section={section} />
          ))
        )}
      </DossierGroup>

      <DossierGroup title="接続点">
        {dossier.serviceHooks.length === 0 ? (
          <p className="text-sm text-neutral-500">接続点はありません</p>
        ) : (
          dossier.serviceHooks.map((section, index) => (
            <DossierSectionItem key={index} section={section} />
          ))
        )}
      </DossierGroup>
    </div>
  );
}

function DossierGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-neutral-900">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}
