// 外部由来テキストの型（design-detail 3.3 / basic-design 8.2）。
//
// 「一度外部由来になったものは以後も信頼境界外」（basic-design 6.1）を型レベルで強制する:
// - 出典 URL（https? のみ）と収集日時を必須とし、出典なしのデータは型検査を通らない
// - brand により構造が同じだけの素のオブジェクトを代入できず、
//   untrustedTextSchema.parse() を通したものだけが UntrustedText になる
// - この型の text は**サニタイズ前**の生テキストである。packages/prompt は外部由来テキストを
//   この型でのみ受け取り、S1〜S5 のサニタイズを必ず適用する（呼び出し側を信用しない二重適用）
import { z } from "zod";
import { httpUrlSchema, isoDateTimeSchema } from "./common.js";

export const untrustedTextSchema = z
  .object({
    /** サニタイズ前の生テキスト。プロンプト・シェル・SQL・HTML へ直接渡してはならない */
    text: z.string(),
    /** 出典 URL（必須。https? のみ — design-detail 3.2） */
    sourceUrl: httpUrlSchema,
    /** 収集日時（必須） */
    collectedAt: isoDateTimeSchema,
  })
  .brand<"UntrustedText">();
export type UntrustedText = z.infer<typeof untrustedTextSchema>;

/**
 * UntrustedText の生成ヘルパ（parse の別名）。
 * 出典 URL・収集日時が揃っていなければ例外になる。
 */
export function markUntrusted(input: {
  text: string;
  sourceUrl: string;
  collectedAt: string;
}): UntrustedText {
  return untrustedTextSchema.parse(input);
}
