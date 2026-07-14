// エントリポイント: 設定検証（起動時致命エラー方式）→ 依存組み立て → キュー起動 →
// ワーカー購読 → シグナル収集の cron 登録 → HTTP サーバー起動 → グレースフルシャットダウン。
// LLM の直接呼び出しは禁止（packages/prompt 経由のみ — basic-design 2.1。
// ANTHROPIC_API_KEY は prompt の AnthropicLlmClient が環境から解決し、ワーカーのみが使う）。
import { serve } from "@hono/node-server";
import { createCrawler } from "@is-reach/crawler";
import { AnthropicLlmClient, type PromptRuntime } from "@is-reach/prompt";
import { createApp } from "./app.js";
import { loadApiConfig } from "./config.js";
import { createBatchDb, createTenantDb } from "./db/tenant-db.js";
import { createHs256TokenVerifier } from "./auth/token-verifier.js";
import {
  createSupabaseAuthAdmin,
  createUnconfiguredAuthAdmin,
  type AuthAdmin,
} from "./auth/auth-admin.js";
import { PgBossJobQueue } from "./queue/pg-boss-queue.js";
import { startWorkers } from "./queue/worker.js";
import { createCollectSignalsHandler } from "./workers/collect-signals.js";
import { createDeepDiveHandler } from "./workers/deep-dive.js";
import { createGenerateMessageHandler } from "./workers/generate-message.js";
import { consoleLogger } from "./types.js";

async function main(): Promise<void> {
  // 環境変数の検証失敗は throw → 下の catch で致命エラー終了
  const config = loadApiConfig(process.env);

  const tenantDb = createTenantDb({ connectionString: config.appUserDatabaseUrl });
  const batchDb = createBatchDb({ connectionString: config.batchDatabaseUrl });
  const verifier = createHs256TokenVerifier(config.supabaseJwtSecret);
  const authAdmin: AuthAdmin =
    config.supabaseAdmin !== null
      ? createSupabaseAuthAdmin(config.supabaseAdmin)
      : createUnconfiguredAuthAdmin();
  const queue = PgBossJobQueue.fromConnectionString({
    connectionString: config.batchDatabaseUrl,
  });
  const promptRuntime: PromptRuntime = {
    client: new AnthropicLlmClient(),
    config: config.prompt,
  };

  // pg-boss 起動（pgboss スキーマへの自己マイグレーション込み — E1）+ ワーカー購読
  await queue.start();
  await startWorkers(queue, {
    deep_dive: createDeepDiveHandler({
      tenantDb,
      createCrawler: () => createCrawler(),
      promptRuntime,
      logger: consoleLogger,
    }),
    generate_message: createGenerateMessageHandler({
      tenantDb,
      promptRuntime,
      logger: consoleLogger,
    }),
    collect_signals: createCollectSignalsHandler({
      batchDb,
      createCrawler: () => createCrawler(),
      seeds: config.signalSeeds,
      logger: consoleLogger,
    }),
  });
  // シグナル収集の定期実行（仮置き: 日次深夜帯 — design-detail 5 章。シードは人間確認待ち）
  await queue.schedule("collect_signals", config.signalCollectionCron, {});

  const app = createApp({
    verifier,
    tenantDb,
    queue,
    authAdmin,
    logger: consoleLogger,
    authHookSecret: config.authHookSecret,
  });
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    consoleLogger.info(`apps/api を起動しました（port: ${info.port}, base: /api/v1）`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    consoleLogger.info(`${signal} を受信。シャットダウンします`);
    server.close(() => {
      Promise.allSettled([queue.stop(), tenantDb.end(), batchDb.end()])
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error(
    "起動に失敗しました（致命エラー）:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
