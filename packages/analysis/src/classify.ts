// 収集ページの kind 分類（パイプライン ③ の前処理 — design-detail 3.2 / 3.4(A)）。
//
// design-detail 3.2 の kind のうち、収集ページに適用されるのは
// corporate_site / news / recruit / article の 4 種（signal / dossier は prompt 側で
// Signal 本文・ドシエ由来テキストに付与するもので、ページ分類の対象外）。
//
// 【判定規則 — 決定（ヒューリスティック。判定材料は URL パスとタイトルのみ）】
// 1. URL パスセグメントを深い方（右）から順に走査し、セグメントのトークン
//    （拡張子を除去し `-` `_` `.` で分割・percent-decode 済み・小文字化）が
//    分類語彙（KIND_PATH_TOKENS）に完全一致した最初のセグメントで kind を決める。
//    深いセグメント優先 = より具体的な区分を採用（例: /company/news/2026 → news）。
//    同一セグメントが複数 kind に一致した場合はソース優先度の高い順
//    （corporate_site > news > recruit — design-detail 3.3 S5）で採用する。
// 2. パスで決まらず、パスがルート（"/" または /index.* のみ）なら corporate_site
//    （企業サイトのトップページは会社概要相当として扱う）。
// 3. パスで決まらなければタイトル（NFKC + 小文字化）に分類語彙（KIND_TITLE_KEYWORDS）が
//    部分一致するかを優先度順に調べる。
// 4. どれにも該当しなければ article（その他公開記事）。
//
// トークンは完全一致で照合する（部分一致だと "roundabout" が about に誤ヒットするため）。
// 語彙は定数として一箇所に置き、追加・調整はこのファイルだけで済むようにする。
import { z } from "zod";
import { normalizeForMatch } from "./internal/text-match.js";

// NOTE: この enum は design-detail 3.2 の kind の部分集合であり、analysis → apps/api → prompt を
// 跨ぐパイプライン契約になりうる。PR4（packages/prompt）が external_data の kind
// （corporate_site / news / recruit / article / signal / dossier）を定義する際に二重定義と
// なる場合は、ページ系 4 値の enum を packages/shared へ昇格する follow-up を提案すること
// （basic-design 2.1「型契約の唯一の置き場 = shared」。PR3 のスコープは packages/analysis のみの
// ため本 PR では shared を変更しない）。
export const collectedPageKindSchema = z.enum(["corporate_site", "news", "recruit", "article"]);
export type CollectedPageKind = z.infer<typeof collectedPageKindSchema>;

/**
 * ソース優先度（design-detail 3.3 S5: 会社概要 > ニュース > 採用 > その他公開記事）。
 * 数値が小さいほど優先度が高い。文字数上限による切り捨ては prompt 側の責務で、
 * analysis はこの順序付けまでを担う。
 */
export const PAGE_KIND_PRIORITY: Readonly<Record<CollectedPageKind, number>> = {
  corporate_site: 0,
  news: 1,
  recruit: 2,
  article: 3,
};

/** パス判定の評価順（= ソース優先度順。article はフォールバックのため含めない） */
const KIND_CHECK_ORDER = ["corporate_site", "news", "recruit"] as const;

/** URL パスセグメントのトークン語彙（完全一致。小文字・percent-decode 後） */
const KIND_PATH_TOKENS: Readonly<Record<(typeof KIND_CHECK_ORDER)[number], ReadonlySet<string>>> = {
  corporate_site: new Set([
    "company",
    "corporate",
    "about",
    "aboutus",
    "profile",
    "overview",
    "outline",
    "gaiyo",
    "gaiyou",
    "kaisha",
    "会社概要",
    "会社案内",
    "会社情報",
    "企業情報",
  ]),
  news: new Set([
    "news",
    "press",
    "pressrelease",
    "release",
    "releases",
    "topics",
    "info",
    "information",
    "whatsnew",
    "notice",
    "pr",
    "ニュース",
    "お知らせ",
    "プレスリリース",
  ]),
  recruit: new Set([
    "recruit",
    "recruiting",
    "recruitment",
    "career",
    "careers",
    "job",
    "jobs",
    "saiyo",
    "saiyou",
    "employment",
    "hiring",
    "採用",
    "採用情報",
    "求人",
  ]),
};

/** タイトルの分類語彙（部分一致。NFKC + 小文字化して照合） */
const KIND_TITLE_KEYWORDS: Readonly<Record<(typeof KIND_CHECK_ORDER)[number], readonly string[]>> =
  {
    corporate_site: ["会社概要", "会社案内", "会社情報", "企業情報", "company profile", "about us"],
    news: ["ニュース", "プレスリリース", "お知らせ", "報道", "news", "press release"],
    recruit: ["採用", "求人", "募集", "リクルート", "careers", "recruit"],
  };

/** percent-encoding を可能なら復号する（不正なエンコードは原文のまま扱う） */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** 拡張子（例: .html）を除去する */
function stripExtension(segment: string): string {
  return segment.replace(/\.[a-z0-9]+$/i, "");
}

/** セグメントをトークン列に分割する（小文字化・`-` `_` `.` 区切り） */
function tokenize(segment: string): string[] {
  return stripExtension(decodeSegment(segment).toLowerCase())
    .split(/[-_.]+/)
    .filter((token) => token !== "");
}

/**
 * 収集ページの kind を分類する。
 *
 * @param url 出典 URL（http(s) の絶対 URL。collectedPageSchema 検証済みの値を渡す想定。
 *            URL として解釈できない文字列には TypeError を投げる）
 * @param titleText ページタイトルのテキスト（無ければ null）。外部由来テキストだが
 *                  分類の照合にのみ使い、結果へ出力しない
 */
export function classifyPageKind(url: string, titleText: string | null): CollectedPageKind {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter((segment) => segment !== "");

  // 1. 深いセグメント優先でパス語彙に照合
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (segment === undefined) continue;
    const tokens = tokenize(segment);
    for (const kind of KIND_CHECK_ORDER) {
      const vocabulary = KIND_PATH_TOKENS[kind];
      if (tokens.some((token) => vocabulary.has(token))) return kind;
    }
  }

  // 2. ルート（トップページ）は会社概要相当
  const isRoot =
    segments.length === 0 ||
    (segments.length === 1 &&
      segments[0] !== undefined &&
      stripExtension(segments[0].toLowerCase()) === "index");
  if (isRoot) return "corporate_site";

  // 3. タイトルの部分一致（優先度順）
  if (titleText !== null) {
    const normalizedTitle = normalizeForMatch(titleText);
    for (const kind of KIND_CHECK_ORDER) {
      const hit = KIND_TITLE_KEYWORDS[kind].some((keyword) =>
        normalizedTitle.includes(normalizeForMatch(keyword)),
      );
      if (hit) return kind;
    }
  }

  // 4. フォールバック: その他公開記事
  return "article";
}
