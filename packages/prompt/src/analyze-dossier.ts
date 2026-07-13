// (A) ドシエ分析（design-detail 3.4 A — モデル: Sonnet クラス、決定 E2）。
//
// パイプライン: 入力検証 → S1〜S4（ソース単位）→ 優先度順整列 → S5（合計上限・除外記録）
//   → サンドイッチ構造の組み立て（E6）→ LLM 呼び出し（E11 リトライ + V1 検証/再試行）
//   → V5 / V6 の出力検証（警告付与 — ブロックしない）
//
// 信頼済みパラメータ = 企業の正規化属性 + テナントの自社サービス概要（basic-design 6.1:
// 収集バッチで構造化・正規化済みの短い属性値のみ。自由文テキストは常に external_data 側）。
import { z } from "zod";
import {
  externalDataKindSchema,
  type DossierSection,
  type GenerationWarning,
} from "@is-reach/shared";
import { buildTrustedParametersBlock, buildUserText } from "./assemble.js";
import {
  applyTotalBudget,
  buildSanitizedBlock,
  sortByKindPriority,
  type ExternalDataSource,
  type SanitizedBlock,
} from "./external-data.js";
import { dossierLlmOutputSchema, DOSSIER_TOOL, type LlmDossierSection } from "./llm-output.js";
import type { LlmRequest } from "./llm/client.js";
import { DOSSIER_FINAL_INSTRUCTION, DOSSIER_SYSTEM_PROMPT } from "./prompts.js";
import { normalizeAndStrip } from "./sanitize.js";
import { resolveRuntime, type PromptRuntime } from "./runtime.js";
import { callStructured } from "./structured-call.js";
import {
  validateEvidenceUrls,
  validateInjectionReflection,
  validateNoDelimiterTags,
  validateOffTopic,
} from "./validate.js";

/** 対象企業の正規化属性（信頼済みパラメータ — 短い属性値のみ） */
export const dossierCompanyProfileSchema = z.object({
  name: z.string().min(1, { error: "企業名は必須です" }),
  domain: z.string().nullable().default(null),
  industry: z.string().nullable().default(null),
  employeeRange: z.string().nullable().default(null),
});
export type DossierCompanyProfile = z.infer<typeof dossierCompanyProfileSchema>;

/**
 * ドシエ分析で受け付ける外部ソースの kind（dossier はメッセージ生成専用のため除外）。
 * コンパイル時型に加えて実行時にも enum 検証する（型迂回の遮断）。
 */
export const dossierSourceKindSchema = externalDataKindSchema.exclude(["dossier"]);
export type DossierSourceKind = z.infer<typeof dossierSourceKindSchema>;

export interface DossierAnalysisInput {
  /** 信頼済み: 対象企業の正規化属性 */
  company: DossierCompanyProfile;
  /** 信頼済み: テナントの自社サービス概要（接続点分析に必要） */
  tenantServiceSummary: string;
  /** 信頼境界外: 深掘り収集結果 + Signal 本文（UntrustedText でのみ受け取る） */
  sources: readonly { kind: DossierSourceKind; content: ExternalDataSource["content"] }[];
}

/** 収集ソースの使用記録（S5 の「未使用（容量超過）」の記録を含む — Dossier.sources の材料） */
export interface DossierSourceUsage {
  url: string;
  fetchedAt: string;
  kind: DossierSourceKind;
  /** S4 の切り詰めが発生したか */
  truncated: boolean;
  /** プロンプトに使用したか */
  used: boolean;
  /** 未使用の理由（S5 容量超過のみ） */
  excludedReason: "budget_exceeded" | null;
}

export interface DossierAnalysisResult {
  businessSummary: DossierSection;
  inferredIssues: DossierSection[];
  serviceHooks: DossierSection[];
  sources: DossierSourceUsage[];
  /** V2〜V6 の警告（ブロックせず人手確認へ回す — design-detail 3.5） */
  warnings: GenerationWarning[];
  /** 生成に使ったモデル（決定 E2） */
  modelId: string;
}

/**
 * ドシエ分析を実行する。
 * 失敗は PromptError（LLM_UNAVAILABLE / LLM_OUTPUT_INVALID / INTERNAL）、入力不正は ZodError。
 */
export async function analyzeDossier(
  input: DossierAnalysisInput,
  runtime: PromptRuntime,
): Promise<DossierAnalysisResult> {
  const { client, config, sleep, random } = resolveRuntime(runtime);
  const company = dossierCompanyProfileSchema.parse(input.company);
  const tenantServiceSummary = z.string().min(1).parse(input.tenantServiceSummary);

  // S1〜S4（buildSanitizedBlock 内で UntrustedText を再検証・再サニタイズ。
  // kind は dossier を除く enum として実行時にも検証する）
  const blocks = input.sources.map((source) =>
    buildSanitizedBlock(
      { kind: dossierSourceKindSchema.parse(source.kind), content: source.content },
      config.limits.perSourceChars,
    ),
  );

  // S5: 優先度順（会社概要 > ニュース > 採用 > その他 > シグナル）に採用し、あふれは丸ごと除外
  const prioritized = sortByKindPriority(blocks);
  const { used, excluded } = applyTotalBudget(prioritized, config.limits.dossierTotalChars);

  // サンドイッチ構造の組み立て（E6）
  const trustedBlock = buildTrustedParametersBlock([
    { label: "企業名", value: company.name },
    { label: "ドメイン", value: company.domain ?? "(不明)" },
    { label: "業種", value: company.industry ?? "(不明)" },
    { label: "従業員規模", value: company.employeeRange ?? "(不明)" },
    { label: "自社サービス概要", value: tenantServiceSummary },
  ]);
  const request: LlmRequest = {
    model: config.dossier.modelId,
    maxTokens: config.dossier.maxTokens,
    timeoutMs: config.dossier.timeoutMs,
    system: DOSSIER_SYSTEM_PROMPT,
    userText: buildUserText({
      trustedBlock,
      externalDataBlocks: used.map((block) => block.block),
      finalInstruction: DOSSIER_FINAL_INSTRUCTION,
    }),
    tool: DOSSIER_TOOL,
  };

  // LLM 呼び出し（E11）+ V1 構造検証（1 回だけ再試行）
  const { output, modelId } = await callStructured(
    client,
    request,
    dossierLlmOutputSchema,
    config.retry,
    { ...(sleep !== undefined ? { sleep } : {}), ...(random !== undefined ? { random } : {}) },
  );

  // LLM 出力も信頼境界外として S1+S2 相当の正規化を適用する（注入に追従したモデルが
  // ゼロ幅・双方向文字で V4/V5 検知や人間の目視確認を回避する経路を塞ぐ）
  const cleanSection = (section: LlmDossierSection): LlmDossierSection => ({
    ...section,
    body: normalizeAndStrip(section.body),
  });

  // V6: 根拠 URL の出所検証。照合集合はプロンプトに実際に入れたソース（used）のみとする —
  // S5 で除外したソースの URL は実フェッチ URL ではあるがモデルは本文を見ていないため、
  // それを根拠として通すと出所の捏造になる（設計 3.5 の「収集ソース一覧」の安全側解釈）
  const allowedUrls: ReadonlySet<string> = new Set(used.map((block) => block.sourceUrl));
  const warnings: GenerationWarning[] = [];

  const applyV6 = (name: string, rawSection: LlmDossierSection): DossierSection => {
    const section = cleanSection(rawSection);
    const { evidence, warnings: sectionWarnings } = validateEvidenceUrls(
      name,
      section,
      allowedUrls,
    );
    warnings.push(...sectionWarnings);
    return { body: section.body, evidence };
  };

  const businessSummary = applyV6("businessSummary", output.businessSummary);
  const inferredIssues = output.inferredIssues.map((section, i) =>
    applyV6(`inferredIssues[${i}]`, section),
  );
  const serviceHooks = output.serviceHooks.map((section, i) =>
    applyV6(`serviceHooks[${i}]`, section),
  );

  // V5: 指示追従兆候の検知（① 区切りタグ様文字列 ② 命令調の反映 ③ 無関係トピック）
  const outputTexts = [
    { name: "businessSummary", text: businessSummary.body },
    ...inferredIssues.map((s, i) => ({ name: `inferredIssues[${i}]`, text: s.body })),
    ...serviceHooks.map((s, i) => ({ name: `serviceHooks[${i}]`, text: s.body })),
  ];
  const inputTexts = used.map((block) => block.body);
  warnings.push(
    ...validateNoDelimiterTags(outputTexts),
    ...validateInjectionReflection(inputTexts, outputTexts),
    ...validateOffTopic(outputTexts, [
      company.name,
      company.domain ?? "",
      company.industry ?? "",
      tenantServiceSummary,
    ]),
  );

  return {
    businessSummary,
    inferredIssues,
    serviceHooks,
    sources: [...toUsage(used, true), ...toUsage(excluded, false)],
    warnings,
    modelId,
  };
}

function toUsage(blocks: readonly SanitizedBlock[], used: boolean): DossierSourceUsage[] {
  return blocks.map((block) => ({
    url: block.sourceUrl,
    fetchedAt: block.fetchedAt,
    // ブロックは dossierSourceKindSchema.parse 済みの kind から生成されるためキャストではなく再検証する
    kind: dossierSourceKindSchema.parse(block.kind),
    truncated: block.truncated,
    used,
    excludedReason: used ? null : "budget_exceeded",
  }));
}
