"use client";

// S5 右ペイン: 生成済みメッセージ一覧 + 「メッセージを生成」（ui-spec 2.3 S5）。
// 生成は 202（jobId）を受けて S6 へ即遷移する（ui-spec 4.5 — 生成中表示は S6 側）。
// URL 設計（仮置き）: messageId 未確定のため特殊値 `new` + `?jobId=&templateId=` で S6 へ渡す。
import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Message, Template } from "@is-reach/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { getBrowserApiClient } from "@/lib/api/browser";
import { ApiClientError } from "@/lib/api/client";
import { useApiQuery } from "@/lib/api/use-api-query";
import { formatDateTimeJst } from "@/lib/format/date";
import { fetchMessages, fetchTemplates, generateMessage } from "../api";
import { TemplateSelectModal } from "./template-select-modal";

export interface MessageListPaneProps {
  listId: string;
  entryId: string;
}

export function MessageListPane({ listId, entryId }: MessageListPaneProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [generatePending, setGeneratePending] = useState(false);

  const query = useApiQuery(
    useCallback(
      async (signal: AbortSignal) => {
        const client = getBrowserApiClient();
        const [messages, templates] = await Promise.all([
          fetchMessages(client, entryId, signal),
          fetchTemplates(client, signal),
        ]);
        return { messages: messages.items, templates: templates.items };
      },
      [entryId],
    ),
  );

  const handleGenerate = async (templateId: string) => {
    setGeneratePending(true);
    try {
      const jobId = await generateMessage(getBrowserApiClient(), entryId, templateId);
      router.push(
        `/lists/${encodeURIComponent(listId)}/entries/${encodeURIComponent(entryId)}` +
          `/messages/new?jobId=${encodeURIComponent(jobId)}&templateId=${encodeURIComponent(templateId)}`,
      );
    } catch (error) {
      setGeneratePending(false);
      showToast({ tone: "danger", message: toGenerateErrorMessage(error) });
    }
  };

  return (
    <Card title="メッセージ">
      {query.state.status === "loading" ? (
        <div className="flex flex-col gap-2" aria-label="メッセージ一覧を読み込み中">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : query.state.status === "error" ? (
        <ErrorState
          title="メッセージ一覧の読み込みに失敗しました"
          requestId={query.state.requestId}
          onRetry={query.reload}
        />
      ) : (
        <MessageListContent
          listId={listId}
          entryId={entryId}
          messages={query.state.data.messages}
          templates={query.state.data.templates}
          onOpenGenerate={() => setModalOpen(true)}
        />
      )}

      <TemplateSelectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        templates={query.state.status === "ready" ? query.state.data.templates : []}
        onSubmit={(templateId) => void handleGenerate(templateId)}
        pending={generatePending}
      />
    </Card>
  );
}

function MessageListContent({
  listId,
  entryId,
  messages,
  templates,
  onOpenGenerate,
}: {
  listId: string;
  entryId: string;
  messages: ReadonlyArray<Message>;
  templates: ReadonlyArray<Template>;
  onOpenGenerate: () => void;
}) {
  if (messages.length === 0) {
    return (
      <EmptyState
        title="まだメッセージがありません"
        action={
          <Button variant="primary" onClick={onOpenGenerate}>
            メッセージを生成
          </Button>
        }
      />
    );
  }

  const templateNames = new Map(templates.map((template) => [template.id, template.name]));

  return (
    <div className="flex flex-col gap-3">
      <Button variant="primary" onClick={onOpenGenerate} className="self-start">
        メッセージを生成
      </Button>
      <ul className="flex flex-col divide-y divide-neutral-200">
        {messages.map((message) => (
          <li key={message.id}>
            <Link
              href={`/lists/${encodeURIComponent(listId)}/entries/${encodeURIComponent(entryId)}/messages/${encodeURIComponent(message.id)}`}
              className="flex flex-wrap items-center gap-2 px-1 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
            >
              <span className="text-xs text-neutral-500">
                {formatDateTimeJst(message.generatedAt)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {message.templateId === null
                  ? "削除済みテンプレート"
                  : (templateNames.get(message.templateId) ?? "テンプレート不明")}
              </span>
              {!message.validation.ok ? <Badge tone="warning">⚠ 警告</Badge> : null}
              {message.editedBody !== null ? <Badge tone="neutral">編集済み</Badge> : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function toGenerateErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "JOB_ALREADY_RUNNING") {
      return "実行中のメッセージ生成ジョブがあります。完了までお待ちください";
    }
    if (error.code === "RESOURCE_CONFLICT") {
      return "ドシエが未生成のため生成できません。先に深掘りを実行してください";
    }
    if (error.requestId !== null) {
      return `メッセージ生成の開始に失敗しました（参照 ID: ${error.requestId}）`;
    }
  }
  return "メッセージ生成の開始に失敗しました。時間をおいて再試行してください";
}
