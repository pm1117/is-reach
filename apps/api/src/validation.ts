// リクエスト検証ヘルパー。外部入力（ボディ・パス・クエリ）は必ず zod で確定させる（E17）。
// 失敗は VALIDATION_FAILED(400) の ApiHttpError に正規化する（design-detail 2.5）。
import { uuidSchema } from "@is-reach/shared";
import type { Context } from "hono";
import type { z } from "zod";
import { ApiHttpError, validationError } from "./errors.js";
import type { AppEnv } from "./types.js";

/** JSON ボディをスキーマ検証して返す。JSON でない・検証失敗 → VALIDATION_FAILED */
export async function parseJsonBody<TSchema extends z.ZodType>(
  c: Context<AppEnv>,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiHttpError("VALIDATION_FAILED", "リクエストボディが JSON ではありません");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}

/** パスパラメータを UUID として検証する（不正形式は 400 — 存在有無は漏らさない） */
export function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const value = c.req.param(name);
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiHttpError(
      "VALIDATION_FAILED",
      `パスパラメータ ${name} は UUID で指定してください`,
    );
  }
  return parsed.data;
}

/** クエリ文字列をスキーマ検証して返す */
export function parseQuery<TSchema extends z.ZodType>(
  c: Context<AppEnv>,
  schema: TSchema,
): z.output<TSchema> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}

/**
 * DB 由来の値を API 契約スキーマで確定させる。不適合はリクエスト不正（400）ではなく
 * サーバー側のデータ不整合のため、内部エラー（→ グローバルハンドラで 500 INTERNAL）にする
 * （routes/me.ts で確立したパターンの共通化）。
 */
export function parseDbContract<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  what: string,
): z.output<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${what} が契約に適合しません: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** pg の timestamptz（Date）/ 文字列を ISO 8601（UTC）へ正規化する */
export function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}
