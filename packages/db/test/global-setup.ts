// vitest globalSetup: Docker で Postgres 16 を起動し、supabase/migrations/ を適用する。
//
// testcontainers ではなく docker CLI を直接使う（PR5a の判断）:
// - 依存が @types 込みで数十パッケージ増えるのに対し、必要な操作は
//   run / port / rm の 3 コマンドだけで、待機・後始末も数行で書ける。
// - ローカルに Docker 24 がある前提（CLAUDE.md の pnpm test:db 説明に明記）。
//
// マイグレーションは postgres スーパーユーザーではなく、非スーパーユーザーの
// migrator ロール（CREATEROLE のみ）で適用する。これにより:
// - スーパーユーザー不要でマイグレーションが適用できること自体を検証できる
//   （Supabase の postgres ロールも非スーパーユーザー）。
// - 全テーブルの所有者が非スーパーユーザーになり、FORCE RLS が「所有者にも
//   効くこと」を実際に検証できる（スーパーユーザーは RLS を常にバイパスするため、
//   所有者 = スーパーユーザーだと FORCE の検証にならない）。
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import type { TestProject } from "vitest/node";
import type { DbTestContext } from "./context.js";
import { applyMigrations } from "./migrate.js";

const POSTGRES_IMAGE = "postgres:16-alpine";

// テスト専用のローカル Docker コンテナ内でのみ使う資格情報（秘密情報ではない）
const SUPERUSER = { user: "postgres", password: "dbtest-superuser" } as const;
const MIGRATOR = { user: "migrator", password: "dbtest-migrator" } as const;
const APP_USER = { user: "app_user", password: "dbtest-app-user" } as const;
const APP_BATCH = { user: "app_batch", password: "dbtest-app-batch" } as const;
const DATABASE = "is_reach_test";

function docker(args: string[]): string {
  try {
    return execFileSync("docker", args, { encoding: "utf8" });
  } catch (error) {
    throw new Error(
      `docker ${args[0] ?? ""} に失敗（pnpm test:db は Docker 必須。Docker Desktop / daemon が起動しているか確認）: ${String(error)}`,
      { cause: error },
    );
  }
}

/** `docker port <name> 5432/tcp` の出力（例: "127.0.0.1:55001"）からホスト側ポートを解決する */
function resolveHostPort(containerName: string): number {
  const output = docker(["port", containerName, "5432/tcp"]);
  const match = output
    .trim()
    .split("\n")[0]
    ?.match(/:(\d+)$/);
  const port = match?.[1] !== undefined ? Number.parseInt(match[1], 10) : Number.NaN;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`docker port の出力からポートを解決できない: ${JSON.stringify(output)}`);
  }
  return port;
}

async function connect(
  host: string,
  port: number,
  credential: { user: string; password: string },
  database: string,
): Promise<Client> {
  const client = new Client({ host, port, database, ...credential });
  await client.connect();
  return client;
}

/** コンテナ起動直後は接続拒否 / 初期化中の切断があり得るため、接続できるまでリトライする */
async function waitForPostgres(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const client = await connect(host, port, SUPERUSER, "postgres");
      await client.query("select 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
    }
  }
  throw new Error(`Postgres が ${timeoutMs}ms 以内に起動しない: ${String(lastError)}`);
}

export default async function globalSetup(project: TestProject): Promise<() => void> {
  const containerName = `is-reach-dbtest-${randomBytes(4).toString("hex")}`;

  // イメージ未取得だと docker run が pull で長時間かかるため、明示的に確認して pull する
  try {
    execFileSync("docker", ["image", "inspect", POSTGRES_IMAGE], { stdio: "ignore" });
  } catch {
    console.log(`[db-test] docker pull ${POSTGRES_IMAGE} ...`);
    docker(["pull", POSTGRES_IMAGE]);
  }

  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "-e",
    `POSTGRES_PASSWORD=${SUPERUSER.password}`,
    // ホスト側ポートは 0 指定で空きポートに自動割り当て（他プロセスとの衝突回避）
    "-p",
    "127.0.0.1:0:5432",
    POSTGRES_IMAGE,
  ]);

  const teardown = (): void => {
    docker(["rm", "-f", containerName]);
  };

  try {
    const host = "127.0.0.1";
    const port = resolveHostPort(containerName);
    await waitForPostgres(host, port, 60_000);

    // スーパーユーザーの仕事はここまで: 非スーパーユーザーの migrator と空 DB を用意する
    const admin = await connect(host, port, SUPERUSER, "postgres");
    await admin.query(
      `create role ${MIGRATOR.user} login createrole password '${MIGRATOR.password}'`,
    );
    await admin.query(`create database ${DATABASE} owner ${MIGRATOR.user}`);
    await admin.end();

    // マイグレーション適用（migrator = テーブル所有者）
    const migrator = await connect(host, port, MIGRATOR, DATABASE);
    const applied = await applyMigrations(migrator);
    console.log(`[db-test] applied ${applied.length} migrations: ${applied.join(", ")}`);

    // app_user / app_batch は NOLOGIN で作成される（秘密情報を SQL に残さない —
    // 20260714000100 コメント）。運用の環境構築手順と同様、テストでは適用後に
    // LOGIN とパスワードを付与する。migrator は作成者として ADMIN OPTION を持つ。
    await migrator.query(`alter role ${APP_USER.user} login password '${APP_USER.password}'`);
    await migrator.query(`alter role ${APP_BATCH.user} login password '${APP_BATCH.password}'`);
    await migrator.end();

    const context: DbTestContext = {
      host,
      port,
      database: DATABASE,
      superuser: SUPERUSER,
      migrator: MIGRATOR,
      appUser: APP_USER,
      appBatch: APP_BATCH,
    };
    project.provide("dbtest", context);
  } catch (error) {
    teardown();
    throw error;
  }

  return teardown;
}
