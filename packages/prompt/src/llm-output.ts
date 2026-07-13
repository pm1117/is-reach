// LLM 構造化出力の契約（V1 — design-detail 3.5）。
//
// - zod スキーマ: V1 の構造検証に使う（LLM 出力は信頼境界外の外部入力として必ず検証する）
// - JSON Schema: tool use の input_schema としてモデルへ渡し、構造を強制する
//
// evidence.urls はここでは素の文字列として受け、URL としての妥当性・出所検証（V6）は
// validate.ts の validateEvidenceUrls が行う（httpUrlSchema での正規化を含む）。
import { z } from "zod";

/** LLM が返す evidence（V6 適用前 — urls は未検証文字列） */
export const llmEvidenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sources"),
    urls: z.array(z.string()).min(1),
  }),
  z.object({
    kind: z.literal("none"),
  }),
]);
export type LlmEvidence = z.infer<typeof llmEvidenceSchema>;

/** LLM が返すドシエの 1 セクション（V6 適用前） */
export const llmDossierSectionSchema = z.object({
  body: z.string().min(1),
  evidence: llmEvidenceSchema,
});
export type LlmDossierSection = z.infer<typeof llmDossierSectionSchema>;

/** (A) ドシエ分析の構造化出力（design-detail 3.4 A） */
export const dossierLlmOutputSchema = z.object({
  businessSummary: llmDossierSectionSchema,
  inferredIssues: z.array(llmDossierSectionSchema),
  serviceHooks: z.array(llmDossierSectionSchema),
});
export type DossierLlmOutput = z.infer<typeof dossierLlmOutputSchema>;

/** (B) メッセージ生成の構造化出力（design-detail 3.4 B — hook / issueMention のみ） */
export const messageLlmOutputSchema = z.object({
  hook: z.string().min(1),
  issueMention: z.string().min(1),
});
export type MessageLlmOutput = z.infer<typeof messageLlmOutputSchema>;

// --- tool use に渡す JSON Schema（上記 zod スキーマと同じ構造を手書きで固定する） ---

const EVIDENCE_JSON_SCHEMA = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "sources" },
        urls: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "根拠となる出典 URL（external_data の source_url 属性の値のみ）",
        },
      },
      required: ["kind", "urls"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { kind: { const: "none" } },
      required: ["kind"],
      additionalProperties: false,
      description: "根拠 URL を示せない場合（捏造せず根拠なしを明示する）",
    },
  ],
} as const;

const DOSSIER_SECTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    body: { type: "string", minLength: 1, description: "本文（日本語）" },
    evidence: EVIDENCE_JSON_SCHEMA,
  },
  required: ["body", "evidence"],
  additionalProperties: false,
} as const;

/** (A) ドシエ分析 tool の定義 */
export const DOSSIER_TOOL = {
  name: "emit_dossier_analysis",
  description: "企業調書（ドシエ）の分析結果を構造化して出力する",
  inputSchema: {
    type: "object",
    properties: {
      businessSummary: DOSSIER_SECTION_JSON_SCHEMA,
      inferredIssues: { type: "array", items: DOSSIER_SECTION_JSON_SCHEMA },
      serviceHooks: { type: "array", items: DOSSIER_SECTION_JSON_SCHEMA },
    },
    required: ["businessSummary", "inferredIssues", "serviceHooks"],
    additionalProperties: false,
  } as Record<string, unknown>,
} as const;

/** (B) メッセージ生成 tool の定義 */
export const MESSAGE_TOOL = {
  name: "emit_message_parts",
  description: "メッセージのパーソナライズ部分（hook / issueMention）を構造化して出力する",
  inputSchema: {
    type: "object",
    properties: {
      hook: { type: "string", minLength: 1, description: "冒頭の接点（パーソナライズ）" },
      issueMention: {
        type: "string",
        minLength: 1,
        description: "課題への言及（パーソナライズ）",
      },
    },
    required: ["hook", "issueMention"],
    additionalProperties: false,
  } as Record<string, unknown>,
} as const;
