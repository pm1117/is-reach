// 共通プリミティブスキーマ。全スキーマファイルからここを参照する。
import { z } from "zod";

/** UUID（design-detail 2.1: ID は UUID） */
export const uuidSchema = z.uuid({ error: "UUID 形式で指定してください" });

/** ISO 8601 日時（UTC — design-detail 2.1） */
export const isoDateTimeSchema = z.iso.datetime({
  error: "ISO 8601（UTC）形式の日時で指定してください",
});

/**
 * http(s) の URL のみ許可する。
 * - 出典 URL は https? のみ（design-detail 3.2）。javascript: 等の危険スキームを型検査で排除する
 * - URL パーサが黙って除去する空白・制御文字や、external_data の属性値（design-detail 3.2）を
 *   壊しうる引用符・山括弧・バックスラッシュを含む原文は拒否する
 * - 受理した値は new URL().href に正規化して保持する（スキーム/ホストの小文字化等。
 *   V6 の根拠 URL 文字列照合 — design-detail 3.5 — での表記ゆれ事故を防ぐ）
 */
// eslint-disable-next-line no-control-regex -- 制御文字入り URL の拒否が目的
const FORBIDDEN_URL_CHARS = /[\u0000-\u001f\u007f\s"'<>\\]/;

export const httpUrlSchema = z
  .url({
    protocol: /^https?$/,
    error: "http(s) の URL のみ指定できます",
  })
  .refine((value) => !FORBIDDEN_URL_CHARS.test(value), {
    error: "URL に空白・制御文字・引用符・山括弧を含めることはできません",
  })
  .transform((value) => new URL(value).href);
