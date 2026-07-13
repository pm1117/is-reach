// analysis への入力契約。
//
// - データの取得・永続化は apps/api の責務（basic-design 2.1）。analysis は in-memory の
//   配列を受け取る純粋関数のみを公開し、DB / HTTP / LLM にはアクセスしない。
// - 公開関数は受け取った配列を必ずここのスキーマで検証してから使う
//   （外部入力はスキーマ検証で型を確定させる — CLAUDE.md / feature-dev skill の必須要件）。
// - crawler の型は import しない（packages 横依存の禁止 — basic-design 2.2）。crawler の
//   `FetchedPage` と構造的に互換な `CollectedPage` を analysis 側で定義する
//   （余剰プロパティ（requestedUrl 等）は zod の parse で除去される）。
import { z } from "zod";
import {
  httpUrlSchema,
  isoDateTimeSchema,
  signalKindSchema,
  untrustedTextSchema,
  uuidSchema,
} from "@is-reach/shared";

/** 企業マスタ（共有資産 — basic-design 3.2）のスクリーニング入力ビュー */
export const companyRecordSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  domain: z.string().nullable(),
  /** 業種（facets が提供する区分値。null = 未設定） */
  industry: z.string().nullable(),
  /** 従業員規模の区分コード（facets が提供） */
  employeeRange: z.string().nullable(),
  region: z.string().nullable(),
});
export type CompanyRecord = z.infer<typeof companyRecordSchema>;

/** 公開シグナル（共有資産 — basic-design 3.2）のスクリーニング入力ビュー */
export const signalRecordSchema = z.object({
  id: uuidSchema,
  companyId: uuidSchema,
  kind: signalKindSchema,
  /** 要約（収集バッチが構造化済み。表示・キーワード照合に使う） */
  summary: z.string(),
  /** 抽出キーワード（例: 求人の技術キーワード。キーワード照合の対象） */
  keywords: z.array(z.string()),
  /** 出典 URL（必須 — basic-design 3.4） */
  sourceUrl: httpUrlSchema,
  /** 収集日時（必須。鮮度判定の対象） */
  collectedAt: isoDateTimeSchema,
});
export type SignalRecord = z.infer<typeof signalRecordSchema>;

/**
 * 深掘りで収集された 1 ページ（パイプライン ③ の analysis 入力）。
 * crawler の `FetchedPage` と構造的に互換（url / fetchedAt / title / text）。
 * title・text は外部由来のため `UntrustedText` のまま受け取り、プレーン文字列に展開しない
 * （信頼境界を破らない — basic-design 6.1）。
 */
export const collectedPageSchema = z.object({
  /** リダイレクト解決後の最終 URL（= 出典 URL） */
  url: httpUrlSchema,
  /** 収集日時（ISO 8601） */
  fetchedAt: isoDateTimeSchema,
  /** ページタイトル（外部由来 = 信頼境界外） */
  title: untrustedTextSchema.nullable(),
  /** タグ除去済みのプレーンテキスト本文（外部由来 = 信頼境界外・サニタイズ前） */
  text: untrustedTextSchema,
});
export type CollectedPage = z.infer<typeof collectedPageSchema>;
