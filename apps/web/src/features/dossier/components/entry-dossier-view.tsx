"use client";

// S5 企業詳細のオーケストレータ（features/dossier の入口）。
// - リスト名 + エントリ（企業情報）を取得してパンくず・企業情報カードを描画
// - 深掘りジョブの状態管理（use-deep-dive-job）とドシエ取得を結線
// - 右ペイン（メッセージ一覧 = features/messages）は route ページから ReactNode で
//   受け取って合成する（feature 間 import 禁止 — ui-spec U3 — の範囲で合成は route の責務）
import { useCallback, useState, type ReactNode } from "react";
import type { EntryStatus, ListEntry } from "@is-reach/shared";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { getBrowserApiClient } from "@/lib/api/browser";
import { ApiClientError } from "@/lib/api/client";
import { useApiQuery } from "@/lib/api/use-api-query";
import { fetchDossier, fetchList, findListEntry, updateEntryStatus } from "../api";
import { useDeepDiveJob } from "../hooks/use-deep-dive-job";
import { DossierPanel } from "./dossier-panel";
import { EntryInfoCard } from "./entry-info-card";

export interface EntryDossierViewProps {
  listId: string;
  entryId: string;
  /** 右ペイン（route ページが features/messages のコンポーネントを渡す） */
  aside?: ReactNode;
}

export function EntryDossierView({ listId, entryId, aside }: EntryDossierViewProps) {
  const { showToast } = useToast();

  // リスト名 + エントリ（企業情報・ステータス・latestDeepDiveJobId）
  const headQuery = useApiQuery(
    useCallback(
      async (signal: AbortSignal) => {
        const client = getBrowserApiClient();
        const [list, entry] = await Promise.all([
          fetchList(client, listId, signal),
          findListEntry(client, listId, entryId, signal),
        ]);
        return { list, entry };
      },
      [listId, entryId],
    ),
  );

  // ステータス更新など、取得後のエントリ差分はローカル上書きで反映する
  const [entryOverride, setEntryOverride] = useState<ListEntry | null>(null);
  const [statusPending, setStatusPending] = useState(false);

  const dossierQuery = useApiQuery(
    useCallback(
      (signal: AbortSignal) => fetchDossier(getBrowserApiClient(), entryId, signal),
      [entryId],
    ),
  );
  const reloadDossier = dossierQuery.reload;

  const entry =
    entryOverride ?? (headQuery.state.status === "ready" ? headQuery.state.data.entry : null);

  const deepDive = useDeepDiveJob({
    entryId,
    initialJobId: entry?.latestDeepDiveJobId ?? null,
    onCompleted: reloadDossier,
  });

  const handleStatusChange = async (status: EntryStatus) => {
    setStatusPending(true);
    try {
      const updated = await updateEntryStatus(getBrowserApiClient(), entryId, status);
      setEntryOverride(updated);
    } catch (error) {
      showToast({ tone: "danger", message: toActionErrorMessage(error, "ステータスの更新") });
    } finally {
      setStatusPending(false);
    }
  };

  const handleRunDeepDive = async () => {
    try {
      await deepDive.run();
    } catch (error) {
      showToast({ tone: "danger", message: toActionErrorMessage(error, "深掘りの実行") });
    }
  };

  const handleRetryDeepDive = async () => {
    try {
      await deepDive.retry();
    } catch (error) {
      showToast({ tone: "danger", message: toActionErrorMessage(error, "深掘りの再実行") });
    }
  };

  if (headQuery.state.status === "loading") {
    return (
      <div aria-label="企業詳細を読み込み中">
        <Skeleton className="mb-4 h-6 w-64" />
        <Skeleton className="mb-4 h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (headQuery.state.status === "error" || entry === null) {
    return (
      <ErrorState
        title="企業詳細の読み込みに失敗しました"
        requestId={headQuery.state.status === "error" ? headQuery.state.requestId : null}
        onRetry={headQuery.reload}
      />
    );
  }

  const listName = headQuery.state.data.list.name;

  return (
    <div>
      <PageHeader
        title={entry.company.name}
        breadcrumbs={["リスト", listName, entry.company.name]}
      />
      <div className="flex flex-col gap-4">
        <EntryInfoCard
          entry={entry}
          onStatusChange={(status) => void handleStatusChange(status)}
          statusPending={statusPending}
          job={deepDive.job}
          deepDiveActionPending={deepDive.actionPending}
          onRunDeepDive={() => void handleRunDeepDive()}
          onRetryDeepDive={() => void handleRetryDeepDive()}
        />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <DossierPanel
            dossierState={dossierQuery.state}
            reloadDossier={reloadDossier}
            job={deepDive.job}
            deepDiveActionPending={deepDive.actionPending}
            onRunDeepDive={() => void handleRunDeepDive()}
            onRetryDeepDive={() => void handleRetryDeepDive()}
          />
          {aside !== undefined ? <div className="min-w-0">{aside}</div> : null}
        </div>
      </div>
    </div>
  );
}

/** 操作エラーのトースト文言（サーバー生メッセージは出さず、参照 ID を添える — ui-spec 4.3） */
function toActionErrorMessage(error: unknown, action: string): string {
  if (error instanceof ApiClientError) {
    if (error.code === "JOB_ALREADY_RUNNING") {
      return "実行中の深掘りジョブがあります。完了までお待ちください";
    }
    if (error.requestId !== null) {
      return `${action}に失敗しました（参照 ID: ${error.requestId}）`;
    }
  }
  return `${action}に失敗しました。時間をおいて再試行してください`;
}
