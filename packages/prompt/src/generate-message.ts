// (B) メッセージのパーソナライズ生成（design-detail 3.4 B — モデル: Haiku クラス、決定 E2）。
//
// - LLM が生成するのは hook / issueMention のみ。introduction / cta は Template から
//   機械埋め込みして assembledBody を組み立てる（basic-design 5 処理要点 2 —
//   骨子の欠落・改変リスクを構造的に減らす）
// - 信頼済みパラメータ = Template のトーン・文字数制約・自社サービス概要の要約属性のみ
//   （骨子全文は LLM に渡さない — 3.4 B）
// - 外部データ = Dossier 各セクション（kind="dossier"。一度外部由来になったものは
//   以後も信頼境界外 — basic-design 6.1）
import { z } from "zod";
import { templateSchema, type GenerationWarning, type Template } from "@is-reach/shared";
import { buildTrustedParametersBlock, buildUserText } from "./assemble.js";
import {
  applyTotalBudget,
  buildSanitizedBlock,
  type ExternalDataSource,
  type SanitizedBlock,
} from "./external-data.js";
import { messageLlmOutputSchema, MESSAGE_TOOL } from "./llm-output.js";
import type { LlmRequest } from "./llm/client.js";
import { MESSAGE_FINAL_INSTRUCTION, MESSAGE_SYSTEM_PROMPT } from "./prompts.js";
import { normalizeAndStrip } from "./sanitize.js";
import { resolveRuntime, type PromptRuntime } from "./runtime.js";
import { callStructured } from "./structured-call.js";
import {
  validateInjectionReflection,
  validateLengths,
  validateNoContactInfo,
  validateNoDelimiterTags,
  validateOffTopic,
  validateSkeleton,
} from "./validate.js";

export interface MessageGenerationInput {
  /** 信頼済み（テナント入力）: 骨子・トーン・文字数制約 */
  template: Template;
  /** 信頼済み: 自社サービス概要の要約（文脈整合用） */
  tenantServiceSummary: string;
  /** 信頼境界外: Dossier 各セクション本文（UntrustedText でのみ受け取る。kind は dossier 固定） */
  dossierSections: readonly { content: ExternalDataSource["content"] }[];
}

/** ドシエ由来ソースの使用記録（S5: メッセージ生成は合計 8,000 文字） */
export interface MessageSourceUsage {
  url: string;
  fetchedAt: string;
  truncated: boolean;
  used: boolean;
  excludedReason: "budget_exceeded" | null;
}

export interface MessageGenerationResult {
  /** 骨子（機械埋め込み）とパーソナライズ（LLM 生成）の区別を保持する（shared Message.parts と同形） */
  parts: {
    hook: string;
    issueMention: string;
    introduction: string;
    cta: string;
  };
  /** 組み立て済み全文（hook → introduction → issueMention → cta の順 — 実装判断、要確認） */
  assembledBody: string;
  /** V2〜V5 の検証結果（ok = 警告なし。警告付きでもブロックせず人手確認へ） */
  validation: { ok: boolean; warnings: GenerationWarning[] };
  sources: MessageSourceUsage[];
  modelId: string;
}

/**
 * メッセージのパーソナライズ部分を生成し、骨子へ機械埋め込みして検証する。
 * 失敗は PromptError（LLM_UNAVAILABLE / LLM_OUTPUT_INVALID / INTERNAL）、入力不正は ZodError。
 */
export async function generateMessageParts(
  input: MessageGenerationInput,
  runtime: PromptRuntime,
): Promise<MessageGenerationResult> {
  const { client, config, sleep, random } = resolveRuntime(runtime);
  const template = templateSchema.parse(input.template);
  const tenantServiceSummary = z.string().min(1).parse(input.tenantServiceSummary);

  // S1〜S4 + S5（メッセージ生成: 合計 8,000 文字。ドシエ由来は kind="dossier" 固定 — 3.2）
  const blocks = input.dossierSections.map((section) =>
    buildSanitizedBlock(
      { kind: "dossier", content: section.content },
      config.limits.perSourceChars,
    ),
  );
  const { used, excluded } = applyTotalBudget(blocks, config.limits.messageTotalChars);

  // 信頼済みパラメータ（骨子全文は渡さない — 3.4 B）
  const trustedBlock = buildTrustedParametersBlock([
    { label: "トーン指定", value: template.tone === "" ? "(指定なし)" : template.tone },
    { label: "hook の上限文字数", value: String(config.limits.hookMaxChars) },
    { label: "issueMention の上限文字数", value: String(config.limits.issueMentionMaxChars) },
    { label: "自社サービス概要", value: tenantServiceSummary },
  ]);
  const request: LlmRequest = {
    model: config.message.modelId,
    maxTokens: config.message.maxTokens,
    timeoutMs: config.message.timeoutMs,
    system: MESSAGE_SYSTEM_PROMPT,
    userText: buildUserText({
      trustedBlock,
      externalDataBlocks: used.map((block) => block.block),
      finalInstruction: MESSAGE_FINAL_INSTRUCTION,
    }),
    tool: MESSAGE_TOOL,
  };

  const { output, modelId } = await callStructured(
    client,
    request,
    messageLlmOutputSchema,
    config.retry,
    { ...(sleep !== undefined ? { sleep } : {}), ...(random !== undefined ? { random } : {}) },
  );

  // 骨子への機械埋め込み（basic-design 5 処理要点 2）。
  // LLM 出力も信頼境界外として S1+S2 相当の正規化を適用する（ゼロ幅・双方向文字による
  // V4/V5 検知回避と、コピーされる最終文面への不可視文字混入を防ぐ）
  const parts = {
    hook: normalizeAndStrip(output.hook),
    issueMention: normalizeAndStrip(output.issueMention),
    introduction: template.introduction,
    cta: template.cta,
  };
  const assembledBody = [parts.hook, parts.introduction, parts.issueMention, parts.cta].join(
    "\n\n",
  );

  // V2〜V5（警告として付与 — ブロックしない）
  const personalizedParts = [
    { name: "hook", text: parts.hook },
    { name: "issueMention", text: parts.issueMention },
  ];
  const warnings: GenerationWarning[] = [
    ...validateSkeleton(assembledBody, template),
    ...validateLengths({
      assembledBody,
      maxLength: template.maxLength,
      hook: parts.hook,
      hookMaxChars: config.limits.hookMaxChars,
      issueMention: parts.issueMention,
      issueMentionMaxChars: config.limits.issueMentionMaxChars,
    }),
    ...validateNoContactInfo(personalizedParts),
    ...validateNoDelimiterTags(personalizedParts),
    ...validateInjectionReflection(
      used.map((block) => block.body),
      personalizedParts,
    ),
    ...validateOffTopic(personalizedParts, [
      tenantServiceSummary,
      template.tone,
      template.introduction,
      template.cta,
    ]),
  ];

  return {
    parts,
    assembledBody,
    validation: { ok: warnings.length === 0, warnings },
    sources: [...toUsage(used, true), ...toUsage(excluded, false)],
    modelId,
  };
}

function toUsage(blocks: readonly SanitizedBlock[], used: boolean): MessageSourceUsage[] {
  return blocks.map((block) => ({
    url: block.sourceUrl,
    fetchedAt: block.fetchedAt,
    truncated: block.truncated,
    used,
    excludedReason: used ? null : "budget_exceeded",
  }));
}
