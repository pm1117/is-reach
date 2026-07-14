// apps/api の環境設定（外部入力のため zod 検証 — E17）。
// 検証失敗は起動時致命エラー方式: loadApiConfig() が throw し、エントリポイント
// （index.ts）が process.exit(1) する。既定値で黙って起動しない（接続先・秘密鍵は必須）。
import { signalKindSchema } from "@is-reach/shared";
import { promptConfigFromEnv, type PromptConfig } from "@is-reach/prompt";
import { z } from "zod";

/** postgres:// / postgresql:// の接続文字列のみ許可する */
const postgresUrlSchema = z
  .string()
  .min(1)
  .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
    error: "postgres:// または postgresql:// の接続文字列を指定してください",
  });

/**
 * シグナル収集のシード 1 件（収集対象ソース）。
 * シードリストの具体値は仮置き（pr-plan 4.3: 収集バッチ運用前に人間確認）。
 * 空リストならバッチは何もしない。
 */
export const signalSeedSchema = z.object({
  /** 収集対象ソースの URL（クロール開始点） */
  url: z.url({ protocol: /^https?$/, error: "http(s) の URL のみ指定できます" }),
  /** このソースから作るシグナルの種別 */
  kind: signalKindSchema,
  /** シグナルを紐づける企業のドメイン（省略時はソース URL のホスト名） */
  companyDomain: z.string().min(1).optional(),
  /** 企業が未登録の場合に作成する企業名（省略時はドメイン） */
  companyName: z.string().min(1).optional(),
});
export type SignalSeed = z.infer<typeof signalSeedSchema>;

const signalSeedsSchema = z.array(signalSeedSchema);

const envSchema = z.object({
  /** HTTP リッスンポート */
  PORT: z.coerce
    .number()
    .int({ error: "PORT は整数で指定してください" })
    .min(1)
    .max(65535)
    .default(3001),
  /**
   * テナントデータアクセス用接続（DB ロール app_user — design-detail 6.1）。
   * BYPASSRLS なしのロールであること。service_role キーは使用禁止。
   */
  DATABASE_URL: postgresUrlSchema,
  /**
   * バッチ・pg-boss 管理用接続（DB ロール app_batch — design-detail 6.1）。
   * 共有資産（companies / signals）の書き込みと pgboss スキーマの管理のみに使う。
   * テナント資産の業務クエリには使わないこと。
   */
  BATCH_DATABASE_URL: postgresUrlSchema,
  /**
   * Supabase Auth JWT の検証用シークレット（HS256）。
   * 将来 JWKS（RS256/ES256 署名鍵）へ移行する場合は TokenVerifier の実装追加で対応する
   * （auth/token-verifier.ts — 検証器は注入可能）。
   */
  SUPABASE_JWT_SECRET: z
    .string()
    .min(32, { error: "SUPABASE_JWT_SECRET は 32 文字以上を指定してください" }),
  /**
   * Supabase プロジェクト URL + service_role キー（ユーザー招待・無効化の
   * Auth Admin API 専用 — auth/auth-admin.ts）。DB クエリには使用禁止（design-detail 6.1。
   * 用途を Auth Admin API に限定するため AuthAdmin 実装にのみ渡す）。
   * 未設定の場合、招待・無効化 API は 503 相当のエラーを返す（他機能は動作する）。
   */
  SUPABASE_URL: z.url({ error: "SUPABASE_URL は URL で指定してください" }).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  /**
   * ログインイベント webhook（Supabase Auth Hooks — 仮置きの第一候補実装）の
   * 共有シークレット。未設定なら webhook エンドポイントは無効（404）。
   */
  AUTH_HOOK_SECRET: z
    .string()
    .min(32, { error: "AUTH_HOOK_SECRET は 32 文字以上を指定してください" })
    .optional(),
  /**
   * シグナル収集のシードリスト（JSON 配列 — signalSeedSchema[]）。
   * 仮置き: 具体リストは運用前に人間確認（pr-plan 4.3）。未設定・空配列なら収集しない。
   */
  SIGNAL_SEEDS: z.string().optional(),
  /**
   * シグナル収集バッチの cron（pg-boss スケジュール書式）。
   * 仮置き: 日次深夜帯（design-detail 5 章）。既定 = UTC 18:00 = JST 03:00。
   */
  SIGNAL_COLLECTION_CRON: z.string().min(1).default("0 18 * * *"),
});

export interface ApiConfig {
  port: number;
  /** app_user ロール接続文字列（テナントデータアクセス専用） */
  appUserDatabaseUrl: string;
  /** app_batch ロール接続文字列（pg-boss・共有資産バッチ専用） */
  batchDatabaseUrl: string;
  /** Supabase Auth JWT の HS256 シークレット */
  supabaseJwtSecret: string;
  /** Auth Admin API の設定（未設定なら招待・無効化機能は無効） */
  supabaseAdmin: { url: string; serviceRoleKey: string } | null;
  /** ログイン webhook の共有シークレット（未設定なら webhook 無効） */
  authHookSecret: string | null;
  /** シグナル収集シード（空 = 収集しない） */
  signalSeeds: SignalSeed[];
  /** シグナル収集バッチの cron */
  signalCollectionCron: string;
  /**
   * prompt パッケージの設定（E2: モデル ID 等は環境設定値 — promptConfigFromEnv で合成）。
   * ANTHROPIC_API_KEY は prompt の AnthropicLlmClient が環境から解決する（ワーカーのみが保持）。
   */
  prompt: PromptConfig;
}

/**
 * 環境変数から ApiConfig を組み立てる。検証失敗は対象キーを列挙した Error を throw する
 * （呼び出し側は起動時致命エラーとして扱うこと。シークレット値そのものはメッセージに含めない）。
 */
export function loadApiConfig(env: Record<string, string | undefined>): ApiConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`環境変数の検証に失敗しました（起動を中止します）:\n${issues}`);
  }

  // SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は揃っているときのみ有効
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = parsed.data;
  if ((SUPABASE_URL === undefined) !== (SUPABASE_SERVICE_ROLE_KEY === undefined)) {
    throw new Error(
      "環境変数の検証に失敗しました（起動を中止します）:\n" +
        "  - SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY は両方指定するか両方省略してください",
    );
  }

  let signalSeeds: SignalSeed[] = [];
  if (parsed.data.SIGNAL_SEEDS !== undefined && parsed.data.SIGNAL_SEEDS.trim() !== "") {
    let raw: unknown;
    try {
      raw = JSON.parse(parsed.data.SIGNAL_SEEDS);
    } catch {
      throw new Error(
        "環境変数の検証に失敗しました（起動を中止します）:\n  - SIGNAL_SEEDS: JSON として解析できません",
      );
    }
    const seeds = signalSeedsSchema.safeParse(raw);
    if (!seeds.success) {
      const issues = seeds.error.issues
        .map((issue) => `  - SIGNAL_SEEDS.${issue.path.map(String).join(".")}: ${issue.message}`)
        .join("\n");
      throw new Error(`環境変数の検証に失敗しました（起動を中止します）:\n${issues}`);
    }
    signalSeeds = seeds.data;
  }

  // prompt 設定の合成（promptConfigFromEnv は不正値で throw — 同じ致命エラー方式に乗せる）
  const prompt = promptConfigFromEnv(env);

  return {
    port: parsed.data.PORT,
    appUserDatabaseUrl: parsed.data.DATABASE_URL,
    batchDatabaseUrl: parsed.data.BATCH_DATABASE_URL,
    supabaseJwtSecret: parsed.data.SUPABASE_JWT_SECRET,
    supabaseAdmin:
      SUPABASE_URL !== undefined && SUPABASE_SERVICE_ROLE_KEY !== undefined
        ? { url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY }
        : null,
    authHookSecret: parsed.data.AUTH_HOOK_SECRET ?? null,
    signalSeeds,
    signalCollectionCron: parsed.data.SIGNAL_COLLECTION_CRON,
    prompt,
  };
}
