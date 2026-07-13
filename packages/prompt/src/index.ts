// @is-reach/prompt: Claude API 呼び出しとプロンプトインジェクション対策の唯一の実装点
// （basic-design 6.2 原則 (e) / design-detail 3 章・4.3）。
// 依存は @is-reach/shared のみ。外部サイトアクセス・DB アクセス・ジョブ管理はしない。
//
// 公開 API:
// - analyzeDossier / generateMessageParts: 用途別のプロンプト組み立て + LLM 呼び出し + 出力検証
// - AnthropicLlmClient: Claude API アダプタ（apps/api ワーカーが生成して注入する）
// - LlmClient: テスト・呼び出し側がモックを注入するための抽象

// 用途別 API（3.4）
export {
  analyzeDossier,
  dossierCompanyProfileSchema,
  dossierSourceKindSchema,
  type DossierAnalysisInput,
  type DossierAnalysisResult,
  type DossierCompanyProfile,
  type DossierSourceKind,
  type DossierSourceUsage,
} from "./analyze-dossier.js";
export {
  generateMessageParts,
  type MessageGenerationInput,
  type MessageGenerationResult,
  type MessageSourceUsage,
} from "./generate-message.js";
export { resolveRuntime, type PromptRuntime } from "./runtime.js";

// LLM 抽象層（E2 / E11）
export { AnthropicLlmClient, type AnthropicLlmClientOptions } from "./llm/anthropic-client.js";
export type { LlmClient, LlmRequest, LlmResponse } from "./llm/client.js";
export { callWithRetry, type RetryDeps } from "./llm/retry.js";
export { LlmTransportError, PromptError, type LlmFailureKind } from "./errors.js";

// 設定（E2: モデル ID・max_tokens・タイムアウトは環境設定値）
export {
  defaultPromptConfig,
  promptConfigFromEnv,
  promptConfigSchema,
  type PromptConfig,
} from "./config.js";

// サニタイズ・external_data（E6 / E7 — テスト・レビュー用に公開）
export {
  escapeAttributeValue,
  escapeEntities,
  normalizeAndStrip,
  sanitizeText,
  truncateEscaped,
  type SanitizedText,
} from "./sanitize.js";
export {
  applyTotalBudget,
  buildSanitizedBlock,
  EXTERNAL_DATA_KIND_PRIORITY,
  sortByKindPriority,
  type BudgetResult,
  type ExternalDataSource,
  type SanitizedBlock,
} from "./external-data.js";
export { buildTrustedParametersBlock, buildUserText, TRUSTED_VALUE_MAX_CHARS } from "./assemble.js";

// 出力検証 V1〜V6（E8）
export {
  dossierLlmOutputSchema,
  messageLlmOutputSchema,
  DOSSIER_TOOL,
  MESSAGE_TOOL,
  type DossierLlmOutput,
  type LlmDossierSection,
  type LlmEvidence,
  type MessageLlmOutput,
} from "./llm-output.js";
export {
  validateEvidenceUrls,
  validateInjectionReflection,
  validateLengths,
  validateNoContactInfo,
  validateNoDelimiterTags,
  validateOffTopic,
  validateSkeleton,
  type EvidenceValidationResult,
} from "./validate.js";
export { callStructured, type StructuredCallResult } from "./structured-call.js";

// 注入検知パターン集（V5 — 本パッケージ内で管理・随時更新）
export {
  findInjectionPatterns,
  INJECTION_PATTERNS,
  OFF_TOPIC_KEYWORDS,
  type InjectionPattern,
} from "./injection-patterns.js";

// プロンプト逐語（原則 (a) — packages/prompt 内の定数として管理）
export {
  buildV1RetryNotice,
  DOSSIER_FINAL_INSTRUCTION,
  DOSSIER_SYSTEM_PROMPT,
  MESSAGE_FINAL_INSTRUCTION,
  MESSAGE_SYSTEM_PROMPT,
  SYSTEM_SECURITY_DECLARATION,
  TRUSTED_PARAMETERS_CLOSE,
  TRUSTED_PARAMETERS_OPEN,
  USER_SECURITY_REMINDER,
} from "./prompts.js";
