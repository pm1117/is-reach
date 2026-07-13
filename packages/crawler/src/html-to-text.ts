// HTML → プレーンテキスト抽出とリンク抽出。
// - タグ除去・非本文要素（script / style / nav 等）の除去・タイトル取得のみを行う「素朴なテキスト化」。
//   サニタイズ S1〜S5 は packages/prompt の責務であり、ここでは実装しない
//   （design-detail 3.3 の二重適用方針 — prompt 側が必ず再適用する前提の前段処理）
// - 正規表現ベースの簡易実装（MVP）。厳密な HTML パースはしない方針のため、
//   壊れた HTML では取りこぼしがありうるが、抽出結果は常に UntrustedText として扱われる

export interface ExtractedText {
  /** <title> の内容（なければ null）。外部由来テキストであることに注意 */
  title: string | null;
  /** タグ除去・空白正規化済みの本文テキスト */
  text: string;
}

/** 中身ごと除去する非本文要素（E12 の趣旨: 本文抽出の前処理） */
const NON_CONTENT_ELEMENTS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "canvas",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
] as const;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  yen: "¥",
};

/** HTML エンティティ（名前付きの一部 + 数値参照）を 1 パスで復号する */
export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+[0-9]*);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const codePoint = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (
        !Number.isInteger(codePoint) ||
        codePoint <= 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff) // サロゲート単体は復号しない
      ) {
        return whole;
      }
      return String.fromCodePoint(codePoint);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** HTML からタイトルと本文プレーンテキストを抽出する */
export function extractTextFromHtml(html: string): ExtractedText {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const rawTitle = titleMatch?.[1];
  const title =
    rawTitle === undefined ? null : normalizeWhitespace(decodeHtmlEntities(rawTitle)) || null;

  let working = html;
  working = working.replace(/<!--[\s\S]*?-->/g, " ");
  for (const element of NON_CONTENT_ELEMENTS) {
    working = working.replace(
      new RegExp(`<${element}\\b[^>]*>[\\s\\S]*?</${element}\\s*>`, "gi"),
      " ",
    );
  }
  // ブロック要素の境界と <br> は改行として残す（文の連結事故を防ぐ）
  working = working.replace(
    /<(?:br\b[^>]*|\/(?:p|div|li|tr|h[1-6]|section|article|table|ul|ol|blockquote))\s*>/gi,
    "\n",
  );
  working = working.replace(/<[^>]+>/g, " ");
  working = decodeHtmlEntities(working);

  return { title, text: normalizeBlockText(working) };
}

/** テキスト系（非 HTML）レスポンスの本文正規化 */
export function normalizePlainText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

/**
 * ページ内リンク（<a href>）を絶対 URL で列挙する。
 * http(s) 以外のスキーム・フラグメントのみの参照は除外し、fragment を除去して重複排除する。
 * 同一ドメイン判定・上限制御は呼び出し側（crawler.ts）の責務。
 */
export function extractLinks(html: string, baseUrl: URL): URL[] {
  const links: URL[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*?\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const match of html.matchAll(anchorRe)) {
    const raw = decodeHtmlEntities((match[2] ?? match[3] ?? match[4] ?? "").trim());
    if (raw === "" || raw.startsWith("#")) continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    resolved.hash = "";
    if (seen.has(resolved.href)) continue;
    seen.add(resolved.href);
    links.push(resolved);
  }
  return links;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeBlockText(text: string): string {
  return text
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
