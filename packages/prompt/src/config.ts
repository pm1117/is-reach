// LLM 呼び出しの設定（決定 E2 / E11 / design-detail 3.3 S4・S5）。
// 既定値は設計の決定値・提案値。モデル ID・max_tokens・タイムアウトは環境設定値として
// 差し替え可能（E2）。呼び出し側（apps/api）は promptConfigFromEnv() か部分上書きで注入する。
import { z } from "zod";

/** 用途別のモデル設定（E2: ドシエ分析 = Sonnet クラス / メッセージ生成 = Haiku クラス） */
const modelConfigSchema = z.object({
  /** モデル ID（環境設定値 — E2） */
  modelId: z.string().min(1),
  /** 構造化出力に十分な出力トークン上限 */
  maxTokens: z.number().int().positive(),
  /** 1 呼び出しのタイムアウト（E11: ドシエ分析 120 秒 / メッセージ生成 60 秒） */
  timeoutMs: z.number().int().positive(),
});

/** リトライ方針（design-detail 4.3 — 決定 E11） */
const retryConfigSchema = z.object({
  /** 指数バックオフの初回待機（E11: 2 秒） */
  initialDelayMs: z.number().int().positive().default(2_000),
  /** バックオフ係数（E11: 2） */
  factor: z.number().min(1).default(2),
  /** 429 / 529 の最大試行回数（E11: リトライ最大 5 回 = 初回 + 5） */
  maxRateLimitRetries: z.number().int().min(0).default(5),
  /** 5xx / 接続エラーの最大リトライ回数（E11: 最大 3 回） */
  maxServerErrorRetries: z.number().int().min(0).default(3),
});

/** サニタイズの文字数上限（design-detail 3.3 S4 / S5 — 決定 E7） */
const limitsConfigSchema = z.object({
  /** S4: 1 ソースあたりの上限（30,000 文字） */
  perSourceChars: z.number().int().positive().default(30_000),
  /** S5: ドシエ分析 1 回の合計上限（120,000 文字） */
  dossierTotalChars: z.number().int().positive().default(120_000),
  /** S5: メッセージ生成 1 回の合計上限（8,000 文字） */
  messageTotalChars: z.number().int().positive().default(8_000),
  /**
   * V3: hook（冒頭の接点）の上限文字数。
   * design-detail 3.4(B) は「各上限文字数」を要求するが具体値は未確定 — 仮の既定値（要人間確認）。
   */
  hookMaxChars: z.number().int().positive().default(200),
  /** V3: issueMention（課題への言及）の上限文字数。仮の既定値（要人間確認） */
  issueMentionMaxChars: z.number().int().positive().default(300),
});

export const promptConfigSchema = z.object({
  /** ドシエ分析（E2: Sonnet クラス。例示値 claude-sonnet-5 を既定とする） */
  dossier: modelConfigSchema.default({
    modelId: "claude-sonnet-5",
    maxTokens: 4_096,
    timeoutMs: 120_000,
  }),
  /** メッセージ生成（E2: Haiku クラス。例示値 claude-haiku-4-5 を既定とする） */
  message: modelConfigSchema.default({
    modelId: "claude-haiku-4-5",
    maxTokens: 1_024,
    timeoutMs: 60_000,
  }),
  retry: retryConfigSchema.prefault({}),
  limits: limitsConfigSchema.prefault({}),
});
export type PromptConfig = z.infer<typeof promptConfigSchema>;

/** 設計既定値の PromptConfig を生成する。部分上書きは promptConfigSchema.parse で検証する */
export function defaultPromptConfig(): PromptConfig {
  return promptConfigSchema.parse({});
}

/** 環境変数名 → 設定パスの対応（値はすべて任意。無指定は設計既定値） */
const ENV_KEYS = {
  PROMPT_DOSSIER_MODEL_ID: ["dossier", "modelId"],
  PROMPT_DOSSIER_MAX_TOKENS: ["dossier", "maxTokens"],
  PROMPT_DOSSIER_TIMEOUT_MS: ["dossier", "timeoutMs"],
  PROMPT_MESSAGE_MODEL_ID: ["message", "modelId"],
  PROMPT_MESSAGE_MAX_TOKENS: ["message", "maxTokens"],
  PROMPT_MESSAGE_TIMEOUT_MS: ["message", "timeoutMs"],
} as const;

const INT_ENV_PATTERN = /^\d+$/;

/**
 * 環境変数から PromptConfig を組み立てる（外部入力のためスキーマ検証してから返す）。
 * 数値系の環境変数が整数でない場合は ZodError（VALIDATION 失敗）を投げる。
 */
export function promptConfigFromEnv(env: Record<string, string | undefined>): PromptConfig {
  const raw: {
    dossier: Record<string, string | number>;
    message: Record<string, string | number>;
  } = { dossier: {}, message: {} };

  for (const [envKey, [section, field]] of Object.entries(ENV_KEYS)) {
    const value = env[envKey];
    if (value === undefined || value === "") continue;
    if (field === "modelId") {
      raw[section][field] = value;
    } else {
      if (!INT_ENV_PATTERN.test(value)) {
        throw new Error(`環境変数 ${envKey} は正の整数で指定してください（実際: 非整数）`);
      }
      raw[section][field] = Number(value);
    }
  }

  const defaults = defaultPromptConfig();
  return promptConfigSchema.parse({
    dossier: { ...defaults.dossier, ...raw.dossier },
    message: { ...defaults.message, ...raw.message },
  });
}
