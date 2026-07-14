// テンプレート契約（design-detail 2.3 — 要件 F4 / 決定 E3: 作成・編集・削除は管理者のみ）。
import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";

export const templateSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1, { error: "テンプレート名は必須です" }),
  /** 自社紹介（骨子 — LLM では生成しない） */
  introduction: z.string().min(1, { error: "自社紹介（骨子）は必須です" }),
  /** CTA（骨子 — LLM では生成しない） */
  cta: z.string().min(1, { error: "CTA（骨子）は必須です" }),
  /** トーン指定 */
  tone: z.string(),
  /** 文字数制約（出力検証 V3 で使用） */
  maxLength: z
    .number()
    .int({ error: "maxLength は整数で指定してください" })
    .min(1, { error: "maxLength は 1 以上で指定してください" }),
  /** 作成者（ユーザー削除後は null — DB: ON DELETE SET NULL。2.3 の string から追随） */
  createdBy: uuidSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});
export type Template = z.infer<typeof templateSchema>;

/** POST /templates（作成 — 管理者のみ E3）。id・createdBy・updatedAt はサーバー側で決まる */
export const createTemplateRequestSchema = templateSchema.pick({
  name: true,
  introduction: true,
  cta: true,
  tone: true,
  maxLength: true,
});
export type CreateTemplateRequest = z.infer<typeof createTemplateRequestSchema>;

/** PATCH /templates/:templateId（編集 — 管理者のみ E3。少なくとも 1 項目必須） */
export const updateTemplateRequestSchema = createTemplateRequestSchema
  .partial()
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    error: "変更する項目を 1 つ以上指定してください",
  });
export type UpdateTemplateRequest = z.infer<typeof updateTemplateRequestSchema>;
