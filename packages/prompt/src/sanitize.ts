// サニタイズ S1〜S4（design-detail 3.3 — 決定 E7）。
//
// external_data ブロックへ格納する前に順に適用する:
//   S1: NFC 正規化（NFKC は本文改変が大きいため用いない）
//   S2: 制御文字除去 — C0（\n \t を除く）・C1・U+FEFF・ゼロ幅（U+200B〜U+200F）・
//       双方向制御（U+202A〜U+202E、U+2066〜U+2069）
//   S3: エンティティエスケープ — & → &amp;、< → &lt;、> → &gt; を一律適用。
//       これにより本文中の </external_data> や偽の <external_data ...> がタグとして成立しない
//   S4: 1 ソース 30,000 文字。超過は末尾切り詰め + truncated=true
//
// 上限計測は S3 適用後（= プロンプトに実際に入る文字列）に対して行う（S1→S5 の適用順を保つ）。
// 呼び出し側（crawler / apps/api）が前処理済みでも、本パッケージで必ず再適用する
// （呼び出し側を信用しない二重適用 — 決定）。

// S2: 除去対象の制御・不可視文字。
// - C0 制御文字（U+0000〜U+001F）のうち \t(U+0009) \n(U+000A) 以外
// - DEL（U+007F）と C1 制御文字（U+0080〜U+009F）
// - BOM / ZWNBSP（U+FEFF）
// - ゼロ幅・方向マーク（U+200B〜U+200F: ZWSP/ZWNJ/ZWJ/LRM/RLM）
// - 双方向制御（U+202A〜U+202E: LRE/RLE/PDF/LRO/RLO、U+2066〜U+2069: LRI/RLI/FSI/PDI）
const REMOVED_CHARS = new RegExp(
  // eslint-disable-next-line no-control-regex -- 制御文字の除去が目的
  "[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\uFEFF\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069]",
  "g",
);

// 孤立サロゲート（ペアを成さない上位/下位サロゲート）。JSON 直列化・表示で不正になるため
// S2 と合わせて除去する（正常な UTF-8 デコードでは発生しない想定の防御的措置）
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** S1 + S2: NFC 正規化と制御・不可視文字・孤立サロゲートの除去 */
export function normalizeAndStrip(raw: string): string {
  return raw.normalize("NFC").replace(REMOVED_CHARS, "").replace(LONE_SURROGATE, "");
}

/** S3: エンティティエスケープ（& を最初に置換する — 順序を変えると二重エスケープになる） */
export function escapeEntities(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * S3 適用後の文字列を末尾切り詰めする（S4）。
 * 切断位置がエンティティ（&amp; 等）の途中に落ちた場合は、その不完全なエンティティごと
 * 取り除く（S3 適用後の本文で裸の & はエンティティ先頭にしか現れないため安全に判定できる）。
 */
export function truncateEscaped(
  escaped: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (escaped.length <= maxChars) {
    return { text: escaped, truncated: false };
  }
  const cut = escaped.slice(0, maxChars);
  // 末尾の不完全エンティティ（"&", "&a", "&am", "&amp" / "&l", "&lt" / "&g", "&gt"）と、
  // サロゲートペア分断で残った孤立上位サロゲート（JSON 直列化で不正になる）を除去
  const text = cut.replace(/&[a-z]{0,3}$/, "").replace(/[\uD800-\uDBFF]$/, "");
  return { text, truncated: true };
}

/** S1〜S4 を順に適用した本文（プロンプトへそのまま入れられる形） */
export interface SanitizedText {
  /** エスケープ済み本文（S4 適用後） */
  body: string;
  /** S4 の切り詰めが発生したか */
  truncated: boolean;
}

/** S1→S2→S3→S4 を一括適用する */
export function sanitizeText(raw: string, maxChars: number): SanitizedText {
  const escaped = escapeEntities(normalizeAndStrip(raw));
  const { text, truncated } = truncateEscaped(escaped, maxChars);
  return { body: text, truncated };
}

/**
 * external_data タグの属性値エスケープ（design-detail 3.2: 属性値内の " はエスケープ）。
 * 属性値はすべてシステム側生成（URL は httpUrlSchema 検証済みで " を含まない）だが、
 * 多層防御としてタグ構造を壊しうる文字をすべてエスケープする。
 */
export function escapeAttributeValue(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
