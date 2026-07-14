"use client";

// S8 データ削除依頼対応（要件 6.3 / 決定 E4: 即時物理削除 — 取り消し不可）。
// 依頼はテナント外（メール等）で受け、管理者が本フォームから対象を指定して実行する簡易実装。
import { useState, type FormEvent } from "react";
import {
  deletionRequestSchema,
  type DeletionRequest,
  type DeletionResponse,
} from "@is-reach/shared";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { getBrowserApiClient } from "@/lib/api/browser";
import { mutationErrorMessage, requestDeletion } from "../api";

type Scope = DeletionRequest["scope"];

const SCOPE_OPTIONS = [
  { value: "entry", label: "リストエントリ単位（1 エントリの関連データ）" },
  { value: "company", label: "企業単位（テナント内の当該企業の全データ）" },
] as const;

function isScope(value: string): value is Scope {
  return value === "entry" || value === "company";
}

export function DeletionSection() {
  const client = getBrowserApiClient();
  const { showToast } = useToast();
  const [scope, setScope] = useState<Scope>("entry");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [targetIdError, setTargetIdError] = useState<string | undefined>(undefined);
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<DeletionRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DeletionResponse | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = targetId.trim();
    const parsed = deletionRequestSchema.safeParse({
      scope,
      ...(scope === "entry" ? { entryId: id === "" ? undefined : id } : {}),
      ...(scope === "company" ? { companyId: id === "" ? undefined : id } : {}),
      reason: reason.trim(),
    });
    if (!parsed.success) {
      let nextTargetIdError: string | undefined;
      let nextReasonError: string | undefined;
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "entryId" || key === "companyId") {
          nextTargetIdError = "対象 ID を UUID 形式で入力してください";
        }
        if (key === "reason") {
          nextReasonError = "削除理由を入力してください";
        }
      }
      setTargetIdError(nextTargetIdError);
      setReasonError(nextReasonError);
      return;
    }
    setTargetIdError(undefined);
    setReasonError(undefined);
    setPending(parsed.data);
  }

  async function handleConfirm() {
    if (pending === null) return;
    setSubmitting(true);
    try {
      const response = await requestDeletion(client, pending);
      showToast({ tone: "success", message: "データ削除を実行しました" });
      setResult(response);
      setPending(null);
      setTargetId("");
      setReason("");
    } catch (error) {
      showToast({
        tone: "danger",
        message: mutationErrorMessage(error, "データ削除に失敗しました"),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-label="データ削除依頼対応">
      <h2 className="mb-1 text-lg font-semibold text-neutral-900">データ削除依頼対応</h2>
      <p className="mb-4 text-xs text-neutral-500">
        削除依頼を受けた対象データを即時に物理削除します。削除内容は復元できません（依頼の要旨のみ
        監査ログに記録されます）
      </p>
      <form onSubmit={handleSubmit} className="max-w-2xl space-y-4" noValidate>
        <Select
          label="削除範囲"
          options={SCOPE_OPTIONS}
          value={scope}
          onChange={(event) => {
            if (isScope(event.target.value)) {
              setScope(event.target.value);
              // エントリ ID を企業 ID として誤送信しないよう、範囲切り替えで対象をクリアする
              setTargetId("");
              setTargetIdError(undefined);
            }
          }}
        />
        <TextInput
          label={scope === "entry" ? "対象エントリ ID（UUID）" : "対象企業 ID（UUID）"}
          required
          value={targetId}
          onChange={(event) => setTargetId(event.target.value)}
          error={targetIdError}
        />
        <Textarea
          label="削除理由（依頼の要旨 — 監査ログに記録されます）"
          required
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={reasonError}
        />
        <Button type="submit" variant="danger">
          削除を実行
        </Button>
      </form>

      {result !== null ? (
        <div className="mt-4 max-w-2xl rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          <p className="font-medium">削除結果</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            <li>リストエントリ: {result.deleted.entries} 件</li>
            <li>ドシエ: {result.deleted.dossiers} 件</li>
            <li>収集データ: {result.deleted.collectedDocuments} 件</li>
            <li>メッセージ: {result.deleted.messages} 件</li>
          </ul>
        </div>
      ) : null}

      <Modal
        open={pending !== null}
        onClose={() => {
          if (!submitting) setPending(null);
        }}
        title="データを完全に削除"
        footer={
          <>
            <Button onClick={() => setPending(null)} disabled={submitting}>
              キャンセル
            </Button>
            <Button variant="danger" loading={submitting} onClick={handleConfirm}>
              完全に削除する
            </Button>
          </>
        }
      >
        {pending !== null ? (
          <div className="space-y-2 text-sm text-neutral-700">
            {/* 入力ミス・取り違えに気付けるよう、実行前に対象を明示する */}
            <dl className="rounded-md bg-neutral-50 px-3 py-2 text-xs">
              <div className="flex gap-2">
                <dt className="shrink-0 font-medium text-neutral-500">削除範囲:</dt>
                <dd>
                  {pending.scope === "entry"
                    ? "リストエントリ単位"
                    : "企業単位（テナント内の全データ）"}
                </dd>
              </div>
              <div className="mt-1 flex gap-2">
                <dt className="shrink-0 font-medium text-neutral-500">対象 ID:</dt>
                <dd className="break-all">
                  {pending.scope === "entry" ? pending.entryId : pending.companyId}
                </dd>
              </div>
            </dl>
            <p>
              対象のデータ（ドシエ・収集データ・メッセージ等）を即時に
              <span className="font-semibold text-danger">物理削除</span>します。
            </p>
            <p className="font-medium text-danger">この操作は取り消せません。</p>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
