"use client";

// S6 の読み込み済みメッセージ編集ビュー（ui-spec 6 章 — 決定 U7）。
// - 検証警告バナー（validation.ok === false のとき最上部・warning 色）
// - 編集は明示保存。コピーは保存済み本文に対して行う（未保存時は「保存してコピー」— 仮置き動線）
// - 警告付きコピーは確認ダイアログを一段挟む（ブロッキングではない）
// - コピー成功後もステータスは自動更新せず、「送信済みにする」提案のみ表示する
// - 「送信」という語は操作名に使わない（ui-spec 6.5 — 「送信済みにする」まで）
import { useRef, useState } from "react";
import type { EntryStatus, Message, Template } from "@is-reach/shared";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { getBrowserApiClient } from "@/lib/api/browser";
import { ApiClientError } from "@/lib/api/client";
import { formatDateTimeJst } from "@/lib/format/date";
import { recordCopyEvent, updateEntryStatus, updateMessageBody } from "../api";
import { summarizeWarningCodes } from "@/lib/labels/warning";
import { DossierReferencePane } from "./dossier-reference-pane";
import { MessageBodyEditor } from "./message-body-editor";

/** フッターに常時表示する案内（ui-spec 6.1 / 6.4 — コピーの監査ログ記録を事前明示） */
export const MANUAL_SEND_NOTE =
  "送信はこのツールからは行いません。各企業サイトの問い合わせフォームから手動で送信してください。コピー操作は監査ログに記録されます。";

/** コピー成功トースト（ui-spec 6.4 — 決定文言） */
export const COPY_SUCCESS_MESSAGE =
  "コピーしました。各企業サイトのフォームから手動で送信してください";

export interface MessageEditorProps {
  entryId: string;
  message: Message;
  /** メッセージのテンプレート（削除済みは null） */
  template: Template | null;
  /** 再生成（POST + S6 生成中モードへの遷移は呼び出し側）。失敗時は throw する */
  onRegenerate: (templateId: string) => Promise<void>;
}

export function MessageEditor({ entryId, message, template, onRegenerate }: MessageEditorProps) {
  const { showToast } = useToast();

  // 保存後の最新メッセージはローカルで保持する（props は初期値）
  const [current, setCurrent] = useState(message);
  const savedBody = current.editedBody ?? current.assembledBody;
  const [draft, setDraft] = useState(savedBody);
  const [textMode, setTextMode] = useState(false);
  const dirty = draft !== savedBody;

  const [savePending, setSavePending] = useState(false);
  const [copyStep, setCopyStep] = useState<null | "save" | "warning">(null);
  const [copyPending, setCopyPending] = useState(false);
  const pendingCopyBodyRef = useRef<string | null>(null);
  const [showSentSuggestion, setShowSentSuggestion] = useState(false);
  const [sentPending, setSentPending] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [regeneratePending, setRegeneratePending] = useState(false);

  const save = async (): Promise<Message | null> => {
    setSavePending(true);
    try {
      const updated = await updateMessageBody(getBrowserApiClient(), current.id, draft);
      setCurrent(updated);
      showToast({ tone: "success", message: "変更を保存しました" });
      return updated;
    } catch (error) {
      showToast({ tone: "danger", message: toActionErrorMessage(error, "変更の保存") });
      return null;
    } finally {
      setSavePending(false);
    }
  };

  const executeCopy = async (body: string): Promise<void> => {
    setCopyPending(true);
    try {
      try {
        await navigator.clipboard.writeText(body);
      } catch {
        showToast({
          tone: "danger",
          message: "クリップボードへのコピーに失敗しました。再試行してください",
        });
        return;
      }
      try {
        await recordCopyEvent(getBrowserApiClient(), current.id);
        showToast({ tone: "success", message: COPY_SUCCESS_MESSAGE });
      } catch {
        // コピー自体は完了している。記録失敗は透明性のため通知する
        showToast({
          tone: "danger",
          message: "コピーしましたが、監査ログへの記録に失敗しました",
        });
      }
      // ステータスは自動更新しない（ui-spec 6.4 — 決定）。提案のみ表示する
      setShowSentSuggestion(true);
    } finally {
      setCopyPending(false);
    }
  };

  const handleCopyClick = () => {
    pendingCopyBodyRef.current = savedBody;
    if (dirty) {
      setCopyStep("save");
      return;
    }
    if (!current.validation.ok) {
      setCopyStep("warning");
      return;
    }
    void executeCopy(savedBody);
  };

  const handleSaveAndCopy = async () => {
    const updated = await save();
    if (updated === null) {
      setCopyStep(null);
      return;
    }
    const body = updated.editedBody ?? updated.assembledBody;
    pendingCopyBodyRef.current = body;
    if (!updated.validation.ok) {
      setCopyStep("warning");
      return;
    }
    setCopyStep(null);
    await executeCopy(body);
  };

  const handleWarningConfirmed = async () => {
    const body = pendingCopyBodyRef.current ?? savedBody;
    setCopyStep(null);
    await executeCopy(body);
  };

  const handleMarkSent = async () => {
    setSentPending(true);
    try {
      await updateEntryStatus(getBrowserApiClient(), entryId, "sent" satisfies EntryStatus);
      showToast({ tone: "success", message: "ステータスを送信済みに更新しました" });
      setShowSentSuggestion(false);
    } catch (error) {
      showToast({ tone: "danger", message: toActionErrorMessage(error, "ステータスの更新") });
    } finally {
      setSentPending(false);
    }
  };

  const handleRegenerate = async () => {
    if (current.templateId === null) {
      return;
    }
    setRegeneratePending(true);
    try {
      await onRegenerate(current.templateId);
    } catch (error) {
      showToast({ tone: "danger", message: toActionErrorMessage(error, "再生成の開始") });
    } finally {
      setRegeneratePending(false);
      setConfirmRegenerate(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* メタ行: テンプレート名・生成日時 + 再生成 */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-neutral-700">
        <span>
          <span className="text-xs font-medium text-neutral-500">テンプレート: </span>
          {template !== null ? template.name : "削除済みテンプレート"}
        </span>
        <span>
          <span className="text-xs font-medium text-neutral-500">生成日時: </span>
          {formatDateTimeJst(current.generatedAt)}
        </span>
        {current.templateId !== null ? (
          <Button size="sm" onClick={() => setConfirmRegenerate(true)}>
            再生成
          </Button>
        ) : (
          <span className="text-xs text-neutral-500">
            テンプレートが削除されているため再生成できません
          </span>
        )}
      </div>

      {/* 検証警告バナー（ui-spec 6.3 — 最上部・warning 色） */}
      {!current.validation.ok ? (
        <div
          role="alert"
          className="rounded-md border border-warning bg-warning-subtle p-3 text-sm text-warning-hover"
        >
          この生成文は自動検証で警告が検出されました:{" "}
          {summarizeWarningCodes(current.validation.warnings.map((warning) => warning.code))}
          。内容を必ず確認し、必要に応じて修正または再生成してください
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* 編集エリア（左） */}
        <div className="flex flex-col gap-3">
          <MessageBodyEditor
            message={current}
            template={template}
            draft={draft}
            onDraftChange={setDraft}
            textMode={textMode}
            onStartEditing={() => setTextMode(true)}
          />

          {showSentSuggestion ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-2 rounded-md border border-primary bg-primary-subtle p-3 text-sm text-neutral-800"
            >
              <span>ステータスを送信済みにしますか？</span>
              <Button size="sm" loading={sentPending} onClick={() => void handleMarkSent()}>
                送信済みにする
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowSentSuggestion(false)}>
                閉じる
              </Button>
            </div>
          ) : null}

          {/* フッター（ui-spec 6.1） */}
          <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
            <div className="flex items-center gap-2">
              <Button disabled={!dirty} loading={savePending} onClick={() => void save()}>
                変更を保存
              </Button>
              <Button
                variant="primary"
                loading={copyPending}
                onClick={handleCopyClick}
                className="px-5 py-2 text-sm"
              >
                本文をコピー
              </Button>
            </div>
            <p className="text-xs text-neutral-500">ℹ {MANUAL_SEND_NOTE}</p>
          </div>
        </div>

        {/* 参照ペイン（右） */}
        <DossierReferencePane entryId={entryId} />
      </div>

      {/* 未保存変更ありコピーの確認（ui-spec 6.4 — 「保存してコピー」仮置き動線） */}
      <Modal
        open={copyStep === "save"}
        onClose={() => setCopyStep(null)}
        title="未保存の変更があります"
        footer={
          <>
            <Button onClick={() => setCopyStep(null)} disabled={savePending || copyPending}>
              キャンセル
            </Button>
            <Button
              variant="primary"
              loading={savePending || copyPending}
              onClick={() => void handleSaveAndCopy()}
            >
              保存してコピー
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          コピーは保存済みの本文に対して行われます。変更を保存してからコピーしますか？
        </p>
      </Modal>

      {/* 警告付きメッセージのコピー確認（ui-spec 6.3 — 決定文言） */}
      <Modal
        open={copyStep === "warning"}
        onClose={() => setCopyStep(null)}
        title="検証警告があります"
        footer={
          <>
            <Button onClick={() => setCopyStep(null)} disabled={copyPending}>
              キャンセル
            </Button>
            <Button
              variant="primary"
              loading={copyPending}
              onClick={() => void handleWarningConfirmed()}
            >
              確認済み・コピーする
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          このメッセージには検証警告があります。内容を確認しましたか？
        </p>
      </Modal>

      {/* 再生成の確認 */}
      <Modal
        open={confirmRegenerate}
        onClose={() => setConfirmRegenerate(false)}
        title="メッセージを再生成しますか？"
        footer={
          <>
            <Button onClick={() => setConfirmRegenerate(false)} disabled={regeneratePending}>
              キャンセル
            </Button>
            <Button
              variant="primary"
              loading={regeneratePending}
              onClick={() => void handleRegenerate()}
            >
              再生成する
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          同じテンプレートで新しいメッセージを生成します。このメッセージは残ります。
        </p>
      </Modal>
    </div>
  );
}

/** 操作エラーのトースト文言（サーバー生メッセージは出さず、参照 ID を添える — ui-spec 4.3） */
function toActionErrorMessage(error: unknown, action: string): string {
  if (error instanceof ApiClientError) {
    if (error.code === "JOB_ALREADY_RUNNING") {
      return "実行中のメッセージ生成ジョブがあります。完了までお待ちください";
    }
    if (error.requestId !== null) {
      return `${action}に失敗しました（参照 ID: ${error.requestId}）`;
    }
  }
  return `${action}に失敗しました。時間をおいて再試行してください`;
}
