// user メッセージのサンドイッチ構造の組み立て（design-detail 3.1 — 決定 E6）。
//
//   ① 信頼済みパラメータブロック（外部由来テキストは入れない）
//   ② セキュリティ宣言の再掲（データブロック直前）
//   ③ external_data ブロック群（サニタイズ済み）
//   ④ 最終指示の再掲（データブロック直後 — データ内の「指示」が最後に来る形を防ぐ）
import {
  TRUSTED_PARAMETERS_CLOSE,
  TRUSTED_PARAMETERS_OPEN,
  USER_SECURITY_REMINDER,
} from "./prompts.js";
import { escapeEntities, normalizeAndStrip, truncateEscaped } from "./sanitize.js";

/**
 * 信頼済みパラメータの値 1 件あたりの上限文字数（多層防御）。
 * 設計 3.1 は信頼済みパラメータを「短い属性値のみ」と規定しており、これを実装で強制する
 * （テナント入力・正規化済み企業属性が想定外に長い場合の安全弁。超過は末尾切り詰め）。
 */
export const TRUSTED_VALUE_MAX_CHARS = 2_000;

/**
 * 信頼済みパラメータブロックを組み立てる。
 * 値はテナント入力（Template 等）や外部収集由来の正規化属性を含みうるため、多層防御として
 * S1+S2 相当の正規化（制御・不可視文字の除去）とエンティティエスケープを適用する
 * （偽の external_data / trusted_parameters タグを作らせない）。
 */
export function buildTrustedParametersBlock(
  entries: readonly { label: string; value: string }[],
): string {
  const lines = entries.map(
    (entry) => `- ${sanitizeTrustedValue(entry.label)}: ${sanitizeTrustedValue(entry.value)}`,
  );
  return [TRUSTED_PARAMETERS_OPEN, ...lines, TRUSTED_PARAMETERS_CLOSE].join("\n");
}

function sanitizeTrustedValue(value: string): string {
  const escaped = escapeEntities(normalizeAndStrip(value));
  return truncateEscaped(escaped, TRUSTED_VALUE_MAX_CHARS).text;
}

/** サンドイッチ構造の user テキストを組み立てる（① → ② → ③ → ④ の順序を固定） */
export function buildUserText(params: {
  trustedBlock: string;
  externalDataBlocks: readonly string[];
  finalInstruction: string;
}): string {
  return [
    params.trustedBlock,
    USER_SECURITY_REMINDER,
    ...params.externalDataBlocks,
    params.finalInstruction,
  ].join("\n\n");
}
