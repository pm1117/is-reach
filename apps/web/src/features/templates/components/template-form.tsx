"use client";

// S7 テンプレート作成・編集フォーム（管理者のみ到達 — 呼び出し元がロールで出し分ける）。
// バリデーションは shared の createTemplateRequestSchema（型契約の唯一の正 — E17）に委ねる。
import { useState, type FormEvent } from "react";
import {
  createTemplateRequestSchema,
  type CreateTemplateRequest,
  type Template,
} from "@is-reach/shared";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/text-input";
import { Textarea } from "@/components/ui/textarea";

const FIELD_KEYS = ["name", "introduction", "cta", "tone", "maxLength"] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
type FieldErrors = Partial<Record<FieldKey, string>>;

/** 文字数制約の既定値（仮置き — 新規作成フォームの初期値） */
const DEFAULT_MAX_LENGTH = 400;

export interface TemplateFormProps {
  /** 編集時の初期値。未指定は新規作成 */
  initial?: Template;
  submitting: boolean;
  onSubmit: (values: CreateTemplateRequest) => void;
  onCancel: () => void;
}

function isFieldKey(value: PropertyKey | undefined): value is FieldKey {
  return typeof value === "string" && (FIELD_KEYS as ReadonlyArray<string>).includes(value);
}

export function TemplateForm({ initial, submitting, onSubmit, onCancel }: TemplateFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [introduction, setIntroduction] = useState(initial?.introduction ?? "");
  const [cta, setCta] = useState(initial?.cta ?? "");
  const [tone, setTone] = useState(initial?.tone ?? "");
  const [maxLengthText, setMaxLengthText] = useState(
    String(initial?.maxLength ?? DEFAULT_MAX_LENGTH),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createTemplateRequestSchema.safeParse({
      name: name.trim(),
      introduction,
      cta,
      tone: tone.trim(),
      maxLength: Number(maxLengthText.trim() === "" ? Number.NaN : maxLengthText),
    });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (isFieldKey(key) && errors[key] === undefined) {
          errors[key] = key === "maxLength" ? "1 以上の整数で指定してください" : issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    onSubmit(parsed.data);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <TextInput
        label="テンプレート名"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={fieldErrors.name}
      />
      <Textarea
        label="自社紹介（骨子 — LLM では生成しない）"
        required
        value={introduction}
        onChange={(event) => setIntroduction(event.target.value)}
        error={fieldErrors.introduction}
      />
      <Textarea
        label="CTA（骨子 — LLM では生成しない）"
        required
        rows={3}
        value={cta}
        onChange={(event) => setCta(event.target.value)}
        error={fieldErrors.cta}
      />
      <TextInput
        label="トーン指定"
        placeholder="例: 丁寧・簡潔に"
        value={tone}
        onChange={(event) => setTone(event.target.value)}
        error={fieldErrors.tone}
      />
      <TextInput
        label="文字数制約（生成メッセージの上限文字数）"
        type="number"
        inputMode="numeric"
        min={1}
        required
        value={maxLengthText}
        onChange={(event) => setMaxLengthText(event.target.value)}
        error={fieldErrors.maxLength}
        className="max-w-48"
      />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={submitting}>
          {initial === undefined ? "作成する" : "保存する"}
        </Button>
        <Button onClick={onCancel} disabled={submitting}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}
