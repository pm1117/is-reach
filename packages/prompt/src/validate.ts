// 出力検証 V2〜V6（design-detail 3.5 — 決定 E8。原則 (d) の具体化）。
//
// V2〜V6 の NG はブロックせず GenerationWarning として結果に付与し、画面の警告表示 +
// 人手確認へ回す（basic-design 6.3 の最終防衛線）。V1（構造検証）は structured-call.ts。
import { httpUrlSchema, type Evidence, type GenerationWarning } from "@is-reach/shared";
import { findInjectionPatterns, OFF_TOPIC_KEYWORDS } from "./injection-patterns.js";
import type { LlmDossierSection } from "./llm-output.js";
import { normalizeAndStrip } from "./sanitize.js";

/** V2: 骨子保持チェック — assembledBody に introduction・cta が完全一致で含まれること */
export function validateSkeleton(
  assembledBody: string,
  skeleton: { introduction: string; cta: string },
): GenerationWarning[] {
  const warnings: GenerationWarning[] = [];
  if (!assembledBody.includes(skeleton.introduction)) {
    warnings.push({
      code: "SKELETON_MISSING",
      detail: "自社紹介（introduction）が組み立て後本文に完全一致で含まれていない",
    });
  }
  if (!assembledBody.includes(skeleton.cta)) {
    warnings.push({
      code: "SKELETON_MISSING",
      detail: "CTA が組み立て後本文に完全一致で含まれていない",
    });
  }
  return warnings;
}

/** V3: 文字数制約 */
export function validateLengths(params: {
  assembledBody: string;
  maxLength: number;
  hook: string;
  hookMaxChars: number;
  issueMention: string;
  issueMentionMaxChars: number;
}): GenerationWarning[] {
  const warnings: GenerationWarning[] = [];
  if (params.assembledBody.length > params.maxLength) {
    warnings.push({
      code: "LENGTH_EXCEEDED",
      detail: `assembledBody がテンプレートの maxLength を超過（${params.assembledBody.length} > ${params.maxLength}）`,
    });
  }
  if (params.hook.length > params.hookMaxChars) {
    warnings.push({
      code: "LENGTH_EXCEEDED",
      detail: `hook が上限を超過（${params.hook.length} > ${params.hookMaxChars}）`,
    });
  }
  if (params.issueMention.length > params.issueMentionMaxChars) {
    warnings.push({
      code: "LENGTH_EXCEEDED",
      detail: `issueMention が上限を超過（${params.issueMention.length} > ${params.issueMentionMaxChars}）`,
    });
  }
  return warnings;
}

// V4: URL・メールアドレス・電話番号のパターン。
// - URL: スキーム付き・www. 始まり・主要 TLD の裸ドメイン
// - 電話番号: 区切り（- ( ) 空白 .）を挟んでもよい 10 桁以上の数字列（年号等の誤検知を避ける）
// 警告のみのヒューリスティックであり、TLD リスト等は注入検知パターン集（V5）と同様に
// 「随時更新」の対象とする（完全性は保証しない — 最終防衛線は人手確認）。
const URL_PATTERN = /(https?:\/\/|www\.)\S+/i;
const BARE_DOMAIN_PATTERN =
  /\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|io|ai|dev|app|info|biz|co\.jp|ne\.jp|or\.jp|jp)\b/i;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_PATTERN = /(?:\d[\s\-().]?){9,}\d/;

/** V4: パーソナライズ部分（hook / issueMention）に URL・メール・電話番号が含まれない */
export function validateNoContactInfo(
  parts: readonly { name: string; text: string }[],
): GenerationWarning[] {
  const warnings: GenerationWarning[] = [];
  for (const part of parts) {
    if (URL_PATTERN.test(part.text) || BARE_DOMAIN_PATTERN.test(part.text)) {
      warnings.push({
        code: "URL_IN_OUTPUT",
        detail: `${part.name} に URL とみられる文字列が含まれる`,
      });
    }
    if (EMAIL_PATTERN.test(part.text)) {
      warnings.push({
        code: "URL_IN_OUTPUT",
        detail: `${part.name} にメールアドレスとみられる文字列が含まれる`,
      });
    }
    if (PHONE_PATTERN.test(part.text)) {
      warnings.push({
        code: "URL_IN_OUTPUT",
        detail: `${part.name} に電話番号とみられる文字列が含まれる`,
      });
    }
  }
  return warnings;
}

// V5 ①: 出力内の区切りタグ様文字列。エスケープ形（&lt;）と全角ホモグリフ（＜ U+FF1C /
// ／ U+FF0F — NFC では折り畳まれず S3 でもエスケープされない）も検知する
const DELIMITER_TAG_PATTERN = /(<|＜|&lt;)\s*[/／]?\s*external_data/i;

/** V5 ①: 出力に区切りタグ様文字列が含まれない */
export function validateNoDelimiterTags(
  outputs: readonly { name: string; text: string }[],
): GenerationWarning[] {
  const warnings: GenerationWarning[] = [];
  for (const output of outputs) {
    if (DELIMITER_TAG_PATTERN.test(output.text)) {
      warnings.push({
        code: "DELIMITER_TAG_IN_OUTPUT",
        detail: `${output.name} に external_data タグ様の文字列が含まれる`,
      });
    }
  }
  return warnings;
}

/**
 * V5 ②: 入力データブロック内に存在した命令調フレーズが出力へ反映されていないか。
 * 入力（サニタイズ済み本文）と出力の両方に一致したパターンのみ警告する。
 */
export function validateInjectionReflection(
  inputTexts: readonly string[],
  outputs: readonly { name: string; text: string }[],
): GenerationWarning[] {
  const inputPatternIds = new Set(
    inputTexts.flatMap((text) => findInjectionPatterns(text).map((p) => p.id)),
  );
  if (inputPatternIds.size === 0) return [];

  const warnings: GenerationWarning[] = [];
  for (const output of outputs) {
    for (const pattern of findInjectionPatterns(output.text)) {
      if (inputPatternIds.has(pattern.id)) {
        warnings.push({
          code: "INJECTION_PATTERN_REFLECTED",
          detail: `入力データ内の命令調フレーズ（${pattern.id}）が ${output.name} に反映されている`,
        });
      }
    }
  }
  return warnings;
}

/**
 * V5 ③: 無関係トピック混入のキーワード照合ヒューリスティック。
 * OFF_TOPIC_KEYWORDS のうち、信頼済みコンテキスト（企業属性・自社サービス概要・テンプレート等）に
 * 含まれない語が出力に現れた場合に警告する（信頼済み側に正当に現れる語は誤検知としてスキップ）。
 */
export function validateOffTopic(
  outputs: readonly { name: string; text: string }[],
  trustedContext: readonly string[],
): GenerationWarning[] {
  const trusted = trustedContext.join("\n").toLowerCase();
  const warnings: GenerationWarning[] = [];
  for (const output of outputs) {
    const lower = output.text.toLowerCase();
    for (const keyword of OFF_TOPIC_KEYWORDS) {
      const key = keyword.toLowerCase();
      if (lower.includes(key) && !trusted.includes(key)) {
        warnings.push({
          code: "OFF_TOPIC_SUSPECTED",
          detail: `${output.name} に無関係トピックの語「${keyword}」が含まれる`,
        });
      }
    }
  }
  return warnings;
}

/** V6 の適用結果 */
export interface EvidenceValidationResult {
  evidence: Evidence;
  warnings: GenerationWarning[];
}

/**
 * V6: 根拠 URL の出所検証（ドシエのみ）。
 * evidence.urls を httpUrlSchema で正規化し、収集ソース一覧（正規化済み実フェッチ URL）に
 * 含まれるもののみ残す。含まれない URL・URL として不正な値は除去して警告する。
 * 全 URL が除去された場合は evidence: none に落とす（「根拠なし」の明示 — 要件 F3）。
 *
 * 照合は正規化後同士で行う（shared の httpUrlSchema が new URL().href へ正規化済み —
 * PR3 の申し送り）。allowedUrls には buildSanitizedBlock が返す sourceUrl（正規化済み）を渡す。
 */
export function validateEvidenceUrls(
  sectionName: string,
  section: LlmDossierSection,
  allowedUrls: ReadonlySet<string>,
): EvidenceValidationResult {
  if (section.evidence.kind === "none") {
    return { evidence: { kind: "none" }, warnings: [] };
  }

  const kept = new Set<string>();
  const warnings: GenerationWarning[] = [];
  for (const rawUrl of section.evidence.urls) {
    const parsed = httpUrlSchema.safeParse(rawUrl);
    if (parsed.success && allowedUrls.has(parsed.data)) {
      kept.add(parsed.data); // Set で重複列挙を除去する
    } else {
      warnings.push({
        code: "EVIDENCE_URL_UNKNOWN",
        // detail は DB 保存・UI 表示される。LLM 出力由来の値をそのまま埋め込まず、
        // 制御・不可視文字を除去して長さを制限した参照のみ残す（警告 detail 経由の
        // ペイロード持ち出し・誤誘導文の混入を防ぐ）
        detail: `${sectionName} の根拠 URL が収集ソース一覧に存在しないため除去した: ${sanitizeForDetail(rawUrl)}`,
      });
    }
  }

  if (kept.size === 0) {
    return { evidence: { kind: "none" }, warnings };
  }
  return { evidence: { kind: "sources", urls: [...kept] }, warnings };
}

/** 警告 detail 用の値サニタイズ（S1+S2 相当の正規化 + 200 文字で切り詰め） */
const DETAIL_VALUE_MAX_CHARS = 200;
function sanitizeForDetail(value: string): string {
  const cleaned = normalizeAndStrip(value);
  if (cleaned.length <= DETAIL_VALUE_MAX_CHARS) return cleaned;
  // 切断位置のサロゲートペア分断を防ぐ（truncateEscaped と同じ末尾除去）
  const cut = cleaned.slice(0, DETAIL_VALUE_MAX_CHARS).replace(/[\uD800-\uDBFF]$/, "");
  return `${cut}…(切り詰め)`;
}
