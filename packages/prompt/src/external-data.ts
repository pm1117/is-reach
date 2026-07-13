// external_data ブロックの生成と S5 バジェット（design-detail 3.2 / 3.3 — 決定 E6 / E7）。
//
// - 属性値はすべてシステム側が生成する（外部テキストを属性に入れない）
//   - source_url: UntrustedText.sourceUrl（httpUrlSchema 検証・正規化済み）を再検証して使う
//   - fetched_at: UntrustedText.collectedAt（isoDateTimeSchema 検証済み）を再検証して使う
//   - kind / truncated: 本パッケージが決める
// - 1 ソース = 1 ブロック。連結・入れ子はしない
// - 公開 API は外部由来テキストを shared の UntrustedText 型でのみ受け取る（型で強制 — 3.3）
import {
  externalDataKindSchema,
  httpUrlSchema,
  isoDateTimeSchema,
  untrustedTextSchema,
  type ExternalDataKind,
  type UntrustedText,
} from "@is-reach/shared";
import { escapeAttributeValue, sanitizeText } from "./sanitize.js";

/** 外部由来ソース 1 件（公開 API の入力単位） */
export interface ExternalDataSource {
  kind: ExternalDataKind;
  content: UntrustedText;
}

/** サニタイズ済みの external_data ブロック 1 件 */
export interface SanitizedBlock {
  kind: ExternalDataKind;
  /** 正規化済み出典 URL（V6 の照合はこの値同士で行う） */
  sourceUrl: string;
  fetchedAt: string;
  /** S1〜S4 適用済みの本文 */
  body: string;
  truncated: boolean;
  /** タグを含む完成形ブロック */
  block: string;
}

/**
 * ソース優先度（design-detail 3.3 S5: 会社概要 > ニュース > 採用 > その他公開記事）。
 * signal は設計で順位未指定のため「その他」の末尾、dossier はメッセージ生成専用で
 * 実質同一 kind のみになるため最後に置く。数値が小さいほど優先。
 */
export const EXTERNAL_DATA_KIND_PRIORITY: Readonly<Record<ExternalDataKind, number>> = {
  corporate_site: 0,
  news: 1,
  recruit: 2,
  article: 3,
  signal: 4,
  dossier: 5,
};

/**
 * 1 ソースをサニタイズして external_data ブロックへ組み立てる（S1〜S4 + タグ生成）。
 * UntrustedText を brand ごと再検証する（呼び出し側を信用しない）。検証失敗は ZodError。
 */
export function buildSanitizedBlock(
  source: ExternalDataSource,
  perSourceChars: number,
): SanitizedBlock {
  const content = untrustedTextSchema.parse(source.content);
  // 属性値の再検証（httpUrlSchema は https? のみ許可 + 正規化、" や <> を含む原文は拒否）。
  // kind もコンパイル時型を信用せず実行時に enum 検証する（型迂回による属性注入の遮断）
  const kind = externalDataKindSchema.parse(source.kind);
  const sourceUrl = httpUrlSchema.parse(content.sourceUrl);
  const fetchedAt = isoDateTimeSchema.parse(content.collectedAt);

  const { body, truncated } = sanitizeText(content.text, perSourceChars);
  const attrs = [
    `source_url="${escapeAttributeValue(sourceUrl)}"`,
    `fetched_at="${escapeAttributeValue(fetchedAt)}"`,
    `kind="${escapeAttributeValue(kind)}"`,
    `truncated="${truncated ? "true" : "false"}"`,
  ].join(" ");
  return {
    kind,
    sourceUrl,
    fetchedAt,
    body,
    truncated,
    block: `<external_data ${attrs}>\n${body}\n</external_data>`,
  };
}

/** S5 バジェット適用の結果 */
export interface BudgetResult {
  /** プロンプトへ入れるブロック（入力順を保った採用結果） */
  used: SanitizedBlock[];
  /** 容量超過で丸ごと除外したブロック（「未使用（容量超過）」として結果に記録する） */
  excluded: SanitizedBlock[];
}

/**
 * S5: 1 回の LLM 呼び出しの合計文字数上限を適用する。
 * blocks はソース優先度順に並べて渡すこと（優先度順に採用し、収まらないソースは
 * 丸ごと除外して次のソースを試す）。計測対象は本文（S4 適用後のエスケープ済み文字列）。
 */
export function applyTotalBudget(
  blocks: readonly SanitizedBlock[],
  totalChars: number,
): BudgetResult {
  const used: SanitizedBlock[] = [];
  const excluded: SanitizedBlock[] = [];
  let remaining = totalChars;
  for (const block of blocks) {
    if (block.body.length <= remaining) {
      used.push(block);
      remaining -= block.body.length;
    } else {
      excluded.push(block);
    }
  }
  return { used, excluded };
}

/** ソース優先度順（同順位は入力順を保つ安定ソート）に並べる */
export function sortByKindPriority(blocks: readonly SanitizedBlock[]): SanitizedBlock[] {
  return [...blocks].sort(
    (a, b) => EXTERNAL_DATA_KIND_PRIORITY[a.kind] - EXTERNAL_DATA_KIND_PRIORITY[b.kind],
  );
}
