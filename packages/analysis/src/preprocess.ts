// 深掘り収集結果の前処理（パイプライン ③ の analysis 部分 — basic-design 4.1 / 2.1）。
//
// 収集ページ群を「ドシエ分析（prompt 側）へ渡せる分析入力」に整える:
//   1. スキーマ検証（外部由来テキストは UntrustedText のまま保持し、信頼境界を破らない）
//   2. URL 正規化後の重複除去（同一ページの二重分析を防ぐ）
//   3. kind 分類（→ classify.ts）
//   4. ソース優先度順の整列（会社概要 > ニュース > 採用 > その他公開記事 — design-detail 3.3 S5）
//
// S5 の文字数上限による切り捨て・除外記録は prompt 側（PR4）の責務。analysis は
// 「優先度順に並んだソース列」を返すところまでを担う。LLM 呼び出しの結線は apps/api（PR5b）。
//
// 【重複除去の規則 — 決定】
// - URL は new URL().href に正規化し、fragment（#…）を除去して同一性を判定する
//   （fragment はサーバーに送られずページ実体が同じため）。クエリ文字列は別ページと見なす。
// - 同一 URL が複数あるときは収集日時が最も新しいものを残す。収集日時も同じなら
//   入力順で先のものを残す（決定的）。
//
// 【整列の規則 — 決定（決定的な全順序）】
// kind 優先度昇順 → fetchedAt 降順（新しい順）→ 正規化 URL 昇順。入力順に依存しない。
import { z } from "zod";
import { classifyPageKind, PAGE_KIND_PRIORITY, type CollectedPageKind } from "./classify.js";
import { collectedPageSchema, type CollectedPage } from "./inputs.js";

const collectedPagesSchema = z.array(collectedPageSchema);

/** ドシエ分析へ渡す 1 ソース（優先度順に整列済み。本文・タイトルは UntrustedText のまま） */
export interface DossierSource {
  /** kind 分類の結果（design-detail 3.2 のページ系 kind） */
  kind: CollectedPageKind;
  /** 正規化済みの出典 URL（fragment 除去済み） */
  url: string;
  /** 収集日時（ISO 8601） */
  fetchedAt: string;
  title: CollectedPage["title"];
  text: CollectedPage["text"];
}

/** fragment を除去し URL 正規形にする（collectedPageSchema 検証済みの URL を渡す想定） */
function normalizeSourceUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
}

/**
 * 深掘り収集結果をドシエ分析入力に整える（重複除去 → kind 分類 → 優先度順整列）。
 *
 * 入力はスキーマ検証してから使う。検証に失敗した場合は ZodError を投げる。
 * 決定的（同一入力 → 同一出力・同一順序）。整列は入力順に依存しない全順序だが、
 * 「同一 URL・同一収集日時で本文が異なる」重複だけはタイブレークが入力順（先勝ち）である
 * ことに注意（クローラは同一ジョブ内で同一 URL を再取得しないため、通常は発生しない）。
 *
 * 既知事項: `url` は fragment 除去済みだが、`text.sourceUrl` / `title.sourceUrl` は
 * 呼び出し側から渡された原文のまま保持する（UntrustedText を書き換えない）。
 * V6 の根拠 URL 出所照合（design-detail 3.5）を実装する PR4/PR5b 側では、照合前に
 * 双方を同じ規則で正規化すること。
 */
export function prepareDossierSources(pages: readonly CollectedPage[]): DossierSource[] {
  const validated = collectedPagesSchema.parse(pages);

  // 重複除去: 正規化 URL ごとに「最も新しい収集」を残す（同時刻は先勝ち）
  const byUrl = new Map<string, { page: CollectedPage; url: string; fetchedAtMs: number }>();
  for (const page of validated) {
    const url = normalizeSourceUrl(page.url);
    const fetchedAtMs = Date.parse(page.fetchedAt);
    const existing = byUrl.get(url);
    if (existing === undefined || fetchedAtMs > existing.fetchedAtMs) {
      byUrl.set(url, { page, url, fetchedAtMs });
    }
  }

  const sources: (DossierSource & { fetchedAtMs: number })[] = [];
  for (const { page, url, fetchedAtMs } of byUrl.values()) {
    sources.push({
      kind: classifyPageKind(url, page.title?.text ?? null),
      url,
      fetchedAt: page.fetchedAt,
      title: page.title,
      text: page.text,
      fetchedAtMs,
    });
  }

  // ソース優先度昇順 → 新しい順 → URL 昇順（決定的な全順序）
  sources.sort(
    (a, b) =>
      PAGE_KIND_PRIORITY[a.kind] - PAGE_KIND_PRIORITY[b.kind] ||
      b.fetchedAtMs - a.fetchedAtMs ||
      a.url.localeCompare(b.url),
  );

  return sources.map(({ fetchedAtMs: _fetchedAtMs, ...source }) => source);
}
