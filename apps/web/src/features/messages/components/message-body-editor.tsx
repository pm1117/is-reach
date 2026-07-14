"use client";

// S6 の編集エリア（左・主領域 — ui-spec 6.1 / 6.2）。
// - 未編集時（editedBody === null または assembledBody と一致）は parts を組み立て順に
//   セグメント表示: 骨子 = 淡背景 + 「テンプレート」ラベル / パーソナライズ = 左帯（primary）+
//   「AI 生成 — 内容を確認してください」ラベル
// - クリック / 編集開始で Textarea による全文編集に切替（全体が 1 つの編集可能本文）
// - 編集で境界が崩れた後は追跡せず「編集済み」表示に切替（仮置き — ui-spec 6.2）
// - 本文は LLM 生成 = 外部由来のため表示は SafeText に集約する（ui-spec 7 章 — U8）
import type { Message, Template } from "@is-reach/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SafeText } from "@/components/ui/safe-text";
import { Textarea } from "@/components/ui/textarea";
import { cx } from "@/lib/cx";

/** AI 生成部分のラベル（ui-spec 6.2 / 6.5 — 確認を促す文言） */
export const AI_SEGMENT_LABEL = "AI 生成 — 内容を確認してください";
/** 骨子部分のラベル */
export const TEMPLATE_SEGMENT_LABEL = "テンプレート";
/** 骨子が変更された場合の注記（ui-spec 6.2 — 仮置き） */
export const SKELETON_CHANGED_NOTE = "テンプレートの骨子から変更されています";

/**
 * assembledBody の組み立て順（packages/prompt generate-message.ts:
 * hook → introduction → issueMention → cta を "\n\n" 連結）に合わせたセグメント定義。
 */
const SEGMENTS = [
  { key: "hook", kind: "ai" },
  { key: "introduction", kind: "template" },
  { key: "issueMention", kind: "ai" },
  { key: "cta", kind: "template" },
] as const satisfies ReadonlyArray<{ key: keyof Message["parts"]; kind: "ai" | "template" }>;

export interface MessageBodyEditorProps {
  message: Message;
  /** 文字数制約の参照元（テンプレート削除済み = null の場合は「制約なし」表示） */
  template: Template | null;
  draft: string;
  onDraftChange: (value: string) => void;
  /** 全文編集モード（一度編集を開始したら維持する） */
  textMode: boolean;
  onStartEditing: () => void;
}

export function MessageBodyEditor({
  message,
  template,
  draft,
  onDraftChange,
  textMode,
  onStartEditing,
}: MessageBodyEditorProps) {
  // ui-spec 6.2: セグメント表示は未編集時（editedBody なし or assembledBody と一致）のみ
  const pristine = message.editedBody === null || message.editedBody === message.assembledBody;
  const showSegments = pristine && !textMode;
  const edited = draft !== message.assembledBody;
  const skeletonChanged =
    !draft.includes(message.parts.introduction) || !draft.includes(message.parts.cta);

  return (
    <div className="flex flex-col gap-2">
      {showSegments ? (
        <div
          className="flex flex-col gap-2"
          onClick={(event) => {
            // SafeText の「すべて表示」等のボタン操作では編集モードへ切り替えない
            if (event.target instanceof Element && event.target.closest("button") !== null) {
              return;
            }
            onStartEditing();
          }}
        >
          {SEGMENTS.map(({ key, kind }) => (
            <div
              key={key}
              className={cx(
                "rounded-md p-3",
                kind === "template"
                  ? "bg-neutral-subtle"
                  : "border-l-4 border-l-primary bg-neutral-0 shadow-sm",
              )}
            >
              <p
                className={cx(
                  "mb-1 text-xs font-medium",
                  kind === "template" ? "text-neutral-500" : "text-primary",
                )}
              >
                {kind === "template" ? TEMPLATE_SEGMENT_LABEL : AI_SEGMENT_LABEL}
              </p>
              <SafeText text={message.parts[key]} className="text-sm text-neutral-800" />
            </div>
          ))}
          <Button size="sm" onClick={onStartEditing} className="self-start">
            本文を編集
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {edited ? (
            <Badge tone="neutral" className="self-start">
              編集済み
            </Badge>
          ) : null}
          <Textarea
            aria-label="メッセージ本文"
            rows={16}
            value={draft}
            onChange={(event) => onDraftChange(event.currentTarget.value)}
          />
        </div>
      )}

      {skeletonChanged ? (
        <p className="text-xs text-warning-hover">{SKELETON_CHANGED_NOTE}</p>
      ) : null}

      <CharCounter length={draft.length} maxLength={template?.maxLength ?? null} />
    </div>
  );
}

function CharCounter({ length, maxLength }: { length: number; maxLength: number | null }) {
  const over = maxLength !== null && length > maxLength;
  return (
    <p className={cx("text-xs", over ? "font-medium text-danger" : "text-neutral-500")}>
      文字数: {length} / {maxLength ?? "制約なし"}
      {over ? "（テンプレートの文字数制約を超えています）" : null}
    </p>
  );
}
