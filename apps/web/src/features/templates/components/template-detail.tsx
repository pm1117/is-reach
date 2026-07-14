"use client";

// S7 テンプレート詳細（閲覧は全員）。テンプレート本文はユーザー入力由来のため
// SafeText でプレーンテキスト表示する（ui-spec 7 章 — U8）。
// 管理者向けの「編集」「削除」ボタンは呼び出し元（templates-screen）がロールで出し分けて
// actions として渡す（メンバーには非表示 — disabled ではない。ui-spec 8 章 — U9）。
import type { ReactNode } from "react";
import type { Template } from "@is-reach/shared";
import { SafeText } from "@/components/ui/safe-text";
import { formatDateTimeJst } from "@/lib/format/date";

export interface TemplateDetailProps {
  template: Template;
  /** 作成者の表示名（解決できない場合は null） */
  createdByName: string | null;
  /** 管理者のみ渡される操作ボタン列 */
  actions?: ReactNode;
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-neutral-500">{label}</dt>
      <dd className="mt-1 text-sm text-neutral-800">{children}</dd>
    </div>
  );
}

export function TemplateDetail({ template, createdByName, actions }: TemplateDetailProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <SafeText
          text={template.name}
          maxLines={2}
          className="min-w-0 text-lg font-semibold text-neutral-900"
        />
        {actions !== undefined ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
      </div>
      <dl className="space-y-4">
        <DetailField label="自社紹介（骨子）">
          <SafeText text={template.introduction} />
        </DetailField>
        <DetailField label="CTA（骨子）">
          <SafeText text={template.cta} />
        </DetailField>
        <DetailField label="トーン指定">
          {template.tone === "" ? (
            <span className="text-neutral-400">未設定</span>
          ) : (
            <SafeText text={template.tone} />
          )}
        </DetailField>
        <DetailField label="文字数制約">{template.maxLength} 文字以内</DetailField>
        <DetailField label="作成者">
          {createdByName === null ? (
            <span className="text-neutral-400">—</span>
          ) : (
            <SafeText text={createdByName} maxLines={1} />
          )}
        </DetailField>
        <DetailField label="更新日時">{formatDateTimeJst(template.updatedAt)}</DetailField>
      </dl>
    </div>
  );
}
