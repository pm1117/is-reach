"use client";

// S6 メッセージ生成・編集画面のオーケストレータ（ui-spec 6 章 / 4.5）。
// URL 設計（仮置き）: 生成直後は messageId 未確定のため route の [messageId] に特殊値
// `new` を入れ、`?jobId=&templateId=` で生成ジョブを受ける。done で実 messageId へ
// router.replace する（route 構成を増やさないための実装判断 — PR 本文に申し送り）。
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Message, MessageJob, Template } from "@is-reach/shared";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { SafeText } from "@/components/ui/safe-text";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { getBrowserApiClient } from "@/lib/api/browser";
import { ApiClientError } from "@/lib/api/client";
import { useApiQuery } from "@/lib/api/use-api-query";
import { POLLING_INTERVAL_MS } from "@/lib/config/polling";
import { useJobPolling } from "@/lib/jobs/use-job-polling";
import {
  fetchList,
  fetchMessage,
  fetchMessageJob,
  fetchTemplateOrNull,
  findListEntry,
  generateMessage,
} from "../api";
import { DossierReferencePane } from "./dossier-reference-pane";
import { MessageEditor } from "./message-editor";

/** 生成中モードを表す messageId の特殊値（route [messageId] の予約値 — 仮置き） */
export const GENERATING_MESSAGE_ID = "new";

interface MessageBundle {
  message: Message;
  template: Template | null;
}

export interface MessageEditorScreenProps {
  listId: string;
  entryId: string;
  /** route の messageId（生成中は GENERATING_MESSAGE_ID） */
  messageId: string;
  /** 生成中モードのジョブ ID（?jobId=） */
  jobId: string | null;
  /** 生成中モードのテンプレ ID（?templateId= — 失敗時の再生成でテンプレ選択を保持する） */
  templateId: string | null;
}

export function MessageEditorScreen({
  listId,
  entryId,
  messageId,
  jobId,
  templateId,
}: MessageEditorScreenProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const generating = messageId === GENERATING_MESSAGE_ID;

  // パンくず用のリスト名・企業名（失敗しても画面全体は壊さずプレースホルダで続行する）
  const namesQuery = useApiQuery(
    useCallback(
      async (signal: AbortSignal) => {
        const client = getBrowserApiClient();
        const [list, entry] = await Promise.all([
          fetchList(client, listId, signal),
          findListEntry(client, listId, entryId, signal),
        ]);
        return { listName: list.name, companyName: entry.company.name };
      },
      [listId, entryId],
    ),
  );
  const names =
    namesQuery.state.status === "ready"
      ? namesQuery.state.data
      : { listName: "…", companyName: "…" };

  // ---- 既存メッセージの取得（生成中モードでは何もしない） ----
  const bundleQuery = useApiQuery(
    useCallback(
      async (signal: AbortSignal): Promise<MessageBundle | null> => {
        if (generating) {
          return null;
        }
        const client = getBrowserApiClient();
        const message = await fetchMessage(client, messageId, signal);
        const template =
          message.templateId === null
            ? null
            : await fetchTemplateOrNull(client, message.templateId, signal);
        return { message, template };
      },
      [generating, messageId],
    ),
  );

  // ---- 生成中モード（jobId ポーリング） ----
  const [job, setJob] = useState<MessageJob | null>(null);
  const [generatedBundle, setGeneratedBundle] = useState<MessageBundle | null>(null);
  const [genLoadError, setGenLoadError] = useState<{ requestId: string | null } | null>(null);

  // jobId が変わったら生成状態をリセットして初回取得する
  useEffect(() => {
    setJob(null);
    setGeneratedBundle(null);
    setGenLoadError(null);
    if (!generating || jobId === null) {
      return;
    }
    let active = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const fetched = await fetchMessageJob(getBrowserApiClient(), jobId, controller.signal);
        if (active) {
          setJob(fetched);
        }
      } catch (error) {
        if (active) {
          setGenLoadError({
            requestId: error instanceof ApiClientError ? error.requestId : null,
          });
        }
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [generating, jobId]);

  const jobRunning = job === null || job.state === "queued" || job.state === "generating";
  const pollingActive =
    generating &&
    jobId !== null &&
    genLoadError === null &&
    generatedBundle === null &&
    (job === null || jobRunning);

  useJobPolling({
    poll: useCallback(
      async (signal: AbortSignal) => {
        if (jobId === null) {
          return;
        }
        setJob(await fetchMessageJob(getBrowserApiClient(), jobId, signal));
      },
      [jobId],
    ),
    intervalMs: POLLING_INTERVAL_MS.messageGeneration,
    active: pollingActive,
  });

  // done → メッセージ本体を取得して表示へ切替え、URL を実 messageId に置換する
  const loadingDoneRef = useRef(false);
  useEffect(() => {
    if (!generating || job === null || job.state !== "done" || job.messageId === null) {
      return;
    }
    if (loadingDoneRef.current || generatedBundle !== null) {
      return;
    }
    loadingDoneRef.current = true;
    const realMessageId = job.messageId;
    void (async () => {
      try {
        const client = getBrowserApiClient();
        const message = await fetchMessage(client, realMessageId);
        const template =
          message.templateId === null
            ? null
            : await fetchTemplateOrNull(client, message.templateId);
        setGeneratedBundle({ message, template });
        router.replace(
          `/lists/${encodeURIComponent(listId)}/entries/${encodeURIComponent(entryId)}/messages/${encodeURIComponent(realMessageId)}`,
        );
      } catch (error) {
        setGenLoadError({
          requestId: error instanceof ApiClientError ? error.requestId : null,
        });
      } finally {
        loadingDoneRef.current = false;
      }
    })();
  }, [generating, job, generatedBundle, router, listId, entryId]);

  // 再生成（生成失敗時 / 既存メッセージから）: 新しいジョブを投入して生成中モードへ
  const regenerate = useCallback(
    async (nextTemplateId: string) => {
      const newJobId = await generateMessage(getBrowserApiClient(), entryId, nextTemplateId);
      router.replace(
        `/lists/${encodeURIComponent(listId)}/entries/${encodeURIComponent(entryId)}` +
          `/messages/${GENERATING_MESSAGE_ID}?jobId=${encodeURIComponent(newJobId)}&templateId=${encodeURIComponent(nextTemplateId)}`,
      );
    },
    [entryId, listId, router],
  );

  const handleRetryGenerate = async () => {
    if (templateId === null) {
      return;
    }
    try {
      await regenerate(templateId);
    } catch (error) {
      showToast({ tone: "danger", message: toGenerateErrorMessage(error) });
    }
  };

  const bundle =
    generatedBundle ?? (bundleQuery.state.status === "ready" ? bundleQuery.state.data : null);

  return (
    <div>
      <PageHeader
        title="メッセージ"
        breadcrumbs={["リスト", names.listName, names.companyName, "メッセージ"]}
      />

      {bundle !== null ? (
        <MessageEditor
          key={bundle.message.id}
          entryId={entryId}
          message={bundle.message}
          template={bundle.template}
          onRegenerate={regenerate}
        />
      ) : generating ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <GeneratingPanel
            jobId={jobId}
            job={job}
            loadError={genLoadError}
            canRetry={templateId !== null}
            onRetry={() => void handleRetryGenerate()}
          />
          <DossierReferencePane entryId={entryId} />
        </div>
      ) : bundleQuery.state.status === "error" ? (
        <ErrorState
          title="メッセージの読み込みに失敗しました"
          requestId={bundleQuery.state.requestId}
          onRetry={bundleQuery.reload}
        />
      ) : (
        <MessageSkeleton />
      )}
    </div>
  );
}

/** 生成中の本文領域（スケルトン + 文言 — ui-spec 4.5）と失敗表示 */
function GeneratingPanel({
  jobId,
  job,
  loadError,
  canRetry,
  onRetry,
}: {
  jobId: string | null;
  job: MessageJob | null;
  loadError: { requestId: string | null } | null;
  canRetry: boolean;
  onRetry: () => void;
}) {
  if (jobId === null) {
    return (
      <ErrorState
        title="生成ジョブが指定されていません"
        message="企業詳細のメッセージ一覧からやり直してください"
      />
    );
  }
  if (loadError !== null) {
    return <ErrorState title="生成状態の取得に失敗しました" requestId={loadError.requestId} />;
  }
  if (job !== null && job.state === "failed") {
    return (
      <div className="flex flex-col gap-2">
        <ErrorState
          title="メッセージの生成に失敗しました"
          message="再生成を試すか、時間をおいてやり直してください"
        />
        {job.error !== null ? (
          // 失敗理由は外部由来を含み得るため SafeText（ui-spec 7 章 — U8）
          <SafeText text={job.error.message} maxLines={4} className="text-xs text-neutral-600" />
        ) : null}
        {canRetry ? (
          <Button variant="primary" onClick={onRetry} className="self-center">
            再生成
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="メッセージを生成中">
      <p className="text-sm text-neutral-600">メッセージを生成しています…</p>
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-6 w-5/6" />
    </div>
  );
}

function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="メッセージを読み込み中">
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-8 w-48" />
    </div>
  );
}

function toGenerateErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "JOB_ALREADY_RUNNING") {
      return "実行中のメッセージ生成ジョブがあります。完了までお待ちください";
    }
    if (error.requestId !== null) {
      return `再生成の開始に失敗しました（参照 ID: ${error.requestId}）`;
    }
  }
  return "再生成の開始に失敗しました。時間をおいて再試行してください";
}
