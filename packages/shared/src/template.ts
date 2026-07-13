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
  createdBy: uuidSchema,
  updatedAt: isoDateTimeSchema,
});
export type Template = z.infer<typeof templateSchema>;
