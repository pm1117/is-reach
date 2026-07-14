"use client";

// メッセージ生成前のテンプレート選択モーダル（ui-spec 2.3 S5 — テンプレート選択 → 実行）。
import { useState } from "react";
import type { Template } from "@is-reach/shared";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";

export interface TemplateSelectModalProps {
  open: boolean;
  onClose: () => void;
  templates: ReadonlyArray<Template>;
  /** 生成開始（POST 実行は呼び出し側）。pending の間はボタンをスピナー表示にする */
  onSubmit: (templateId: string) => void;
  pending: boolean;
}

export function TemplateSelectModal({
  open,
  onClose,
  templates,
  onSubmit,
  pending,
}: TemplateSelectModalProps) {
  const [templateId, setTemplateId] = useState("");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="メッセージを生成"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          {templates.length > 0 ? (
            <Button
              variant="primary"
              loading={pending}
              disabled={templateId === ""}
              onClick={() => onSubmit(templateId)}
            >
              生成を開始
            </Button>
          ) : null}
        </>
      }
    >
      {templates.length === 0 ? (
        <p className="text-sm text-neutral-600">
          利用できるテンプレートがありません。管理者に作成を依頼してください。
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <Select
            label="テンプレート"
            placeholder="テンプレートを選択"
            options={templates.map((template) => ({ value: template.id, label: template.name }))}
            value={templateId}
            onChange={(event) => setTemplateId(event.currentTarget.value)}
          />
          <p className="text-xs text-neutral-500">
            選択したテンプレートの骨子（自社紹介・CTA）に、ドシエに基づくパーソナライズ文を
            組み合わせて生成します。
          </p>
        </div>
      )}
    </Modal>
  );
}
