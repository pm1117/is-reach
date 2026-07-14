// apps/api テスト共通ヘルパー: テスト JWT の署名・TenantDb / JobQueue / AuthAdmin の
// フェイク・アプリ組み立て。
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import type { QueryResult, QueryResultRow } from "pg";
import type {
  EnqueueOptions,
  JobQueue,
  QueueJob,
  QueueJobName,
  QueueJobPayloadMap,
} from "@is-reach/shared";
import { createApp } from "../src/app.js";
import { createHs256TokenVerifier } from "../src/auth/token-verifier.js";
import type { AuthAdmin } from "../src/auth/auth-admin.js";
import type { TenantDb, TenantQuerier } from "../src/db/tenant-db.js";
import type { Logger } from "../src/types.js";

export const TEST_JWT_SECRET = "test-jwt-secret-0123456789abcdef0123456789abcdef";
export const TEST_TENANT_ID = "3f8e9d2a-6b4c-4d5e-9f1a-2b3c4d5e6f70";
export const TEST_USER_ID = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
export const TEST_AUTH_USER_ID = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";

export interface SignTestJwtOptions {
  secret?: string;
  sub?: string;
  tenantId?: string;
  role?: string;
  /** app_metadata を丸ごと差し替える（undefined = 既定の { tenant_id, role }） */
  appMetadata?: Record<string, unknown>;
  /** app_metadata クレーム自体を省略する（欠落ケースの検証用） */
  omitAppMetadata?: boolean;
  /** 有効期限（UNIX 秒）。省略時は 1 時間後 */
  expiresAt?: number;
}

export async function signTestJwt(options: SignTestJwtOptions = {}): Promise<string> {
  const {
    secret = TEST_JWT_SECRET,
    sub = TEST_AUTH_USER_ID,
    tenantId = TEST_TENANT_ID,
    role = "member",
    appMetadata,
    omitAppMetadata = false,
    expiresAt = Math.floor(Date.now() / 1000) + 3600,
  } = options;

  const payload: Record<string, unknown> = omitAppMetadata
    ? {}
    : { app_metadata: appMetadata ?? { tenant_id: tenantId, role } };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret));
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export interface RecordedQuery {
  text: string;
  values: readonly unknown[] | undefined;
}

function toQueryResult<R extends QueryResultRow>(rows: QueryResultRow[]): QueryResult<R> {
  return {
    rows: rows as R[],
    rowCount: rows.length,
    command: "",
    oid: 0,
    fields: [],
  } as unknown as QueryResult<R>;
}

export type QueryResponder = (
  values: readonly unknown[] | undefined,
) => QueryResultRow[] | undefined;

/**
 * withTenantContext の呼び出しとクエリを記録するフェイク。
 * respond(pattern, rows | fn) で SQL テキストに応じた行を返す（先勝ち）。
 * どのレスポンダにもマッチしない場合は defaultRows（既定 []）。
 */
export class FakeTenantDb implements TenantDb {
  readonly contexts: string[] = [];
  readonly queries: RecordedQuery[] = [];
  defaultRows: QueryResultRow[];
  ended = false;
  readonly #responders: { pattern: RegExp; respond: QueryResponder }[] = [];

  constructor(defaultRows: QueryResultRow[] = []) {
    this.defaultRows = defaultRows;
  }

  respond(pattern: RegExp, rows: QueryResultRow[] | QueryResponder): this {
    this.#responders.push({
      pattern,
      respond: typeof rows === "function" ? rows : () => rows,
    });
    return this;
  }

  /** 記録済みクエリから pattern にマッチする最初のものを返す（アサーション用） */
  findQuery(pattern: RegExp): RecordedQuery | undefined {
    return this.queries.find((query) => pattern.test(query.text));
  }

  findQueries(pattern: RegExp): RecordedQuery[] {
    return this.queries.filter((query) => pattern.test(query.text));
  }

  async withTenantContext<T>(tenantId: string, fn: (tx: TenantQuerier) => Promise<T>): Promise<T> {
    this.contexts.push(tenantId);
    const tx: TenantQuerier = {
      query: async <R extends QueryResultRow>(text: string, values?: readonly unknown[]) => {
        this.queries.push({ text, values });
        for (const responder of this.#responders) {
          if (responder.pattern.test(text)) {
            const rows = responder.respond(values);
            if (rows !== undefined) return toQueryResult<R>(rows);
          }
        }
        return toQueryResult<R>(this.defaultRows);
      },
    };
    return fn(tx);
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

/** JobQueue のフェイク（投入・スケジュール・購読を記録する） */
export class FakeQueue implements JobQueue {
  readonly enqueued: {
    name: QueueJobName;
    payload: unknown;
    options: EnqueueOptions | undefined;
  }[] = [];
  readonly scheduled: { name: QueueJobName; cron: string; payload: unknown }[] = [];
  readonly subscriptions: QueueJobName[] = [];
  /** 次の enqueue を失敗させる（JobNotEnqueuedError 等の検証用） */
  failNextEnqueueWith: Error | null = null;
  stopped = false;

  async enqueue<TName extends QueueJobName>(
    name: TName,
    payload: QueueJobPayloadMap[TName],
    options?: EnqueueOptions,
  ): Promise<string> {
    if (this.failNextEnqueueWith !== null) {
      const error = this.failNextEnqueueWith;
      this.failNextEnqueueWith = null;
      throw error;
    }
    this.enqueued.push({ name, payload, options });
    return `queued-${this.enqueued.length}`;
  }

  async subscribe<TName extends QueueJobName>(
    name: TName,
    _handler: (job: QueueJob<TName>) => Promise<void>,
  ): Promise<void> {
    this.subscriptions.push(name);
  }

  async schedule<TName extends QueueJobName>(
    name: TName,
    cron: string,
    payload: QueueJobPayloadMap[TName],
  ): Promise<void> {
    this.scheduled.push({ name, cron, payload });
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

/** AuthAdmin のフェイク（呼び出しを記録する） */
export class FakeAuthAdmin implements AuthAdmin {
  readonly invites: { email: string; appMetadata: { tenant_id: string; role: string } }[] = [];
  readonly metadataUpdates: {
    authUserId: string;
    appMetadata: { tenant_id: string; role: string };
  }[] = [];
  readonly disabled: string[] = [];
  nextAuthUserId: string = randomUUID();
  failWith: Error | null = null;

  async inviteUserByEmail(
    email: string,
    appMetadata: { tenant_id: string; role: "admin" | "member" },
  ): Promise<{ authUserId: string }> {
    if (this.failWith !== null) throw this.failWith;
    this.invites.push({ email, appMetadata });
    return { authUserId: this.nextAuthUserId };
  }

  async updateUserAppMetadata(
    authUserId: string,
    appMetadata: { tenant_id: string; role: "admin" | "member" },
  ): Promise<void> {
    if (this.failWith !== null) throw this.failWith;
    this.metadataUpdates.push({ authUserId, appMetadata });
  }

  async disableUser(authUserId: string): Promise<void> {
    if (this.failWith !== null) throw this.failWith;
    this.disabled.push(authUserId);
  }
}

/** 記録専用ロガー（未分類エラーの詳細がログにのみ出ることの検証に使う） */
export class RecordingLogger implements Logger {
  readonly errors: { message: string; meta?: Record<string, unknown> }[] = [];
  readonly infos: { message: string; meta?: Record<string, unknown> }[] = [];

  info(message: string, meta?: Record<string, unknown>): void {
    this.infos.push({ message, meta });
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.errors.push({ message, meta });
  }
}

/** users×tenants JOIN（routes/me.ts）の行フィクスチャ */
export function meRow(overrides: Partial<Record<string, unknown>> = {}): QueryResultRow {
  return {
    id: TEST_USER_ID,
    email: "user@example.com",
    display_name: "担当者",
    role: "member",
    tenant_name: "テストテナント",
    ...overrides,
  };
}

/** resolveActor（routes/deps.ts）が期待する行 */
export function actorRow(overrides: Partial<Record<string, unknown>> = {}): QueryResultRow {
  return { id: TEST_USER_ID, role: "member", ...overrides };
}

/** resolveActor 用レスポンダを登録済みの FakeTenantDb を作る */
export function tenantDbWithActor(defaultRows: QueryResultRow[] = []): FakeTenantDb {
  const db = new FakeTenantDb(defaultRows);
  db.respond(/from users\s+where auth_user_id/, [actorRow()]);
  return db;
}

export interface TestAppBundle {
  app: ReturnType<typeof createApp>;
  tenantDb: FakeTenantDb;
  queue: FakeQueue;
  authAdmin: FakeAuthAdmin;
  logger: RecordingLogger;
}

export function buildTestApp(
  options: {
    rows?: QueryResultRow[];
    tenantDb?: FakeTenantDb;
    authHookSecret?: string | null;
    now?: () => Date;
  } = {},
): TestAppBundle {
  const tenantDb = options.tenantDb ?? new FakeTenantDb(options.rows ?? [meRow()]);
  const queue = new FakeQueue();
  const authAdmin = new FakeAuthAdmin();
  const logger = new RecordingLogger();
  const app = createApp({
    verifier: createHs256TokenVerifier(TEST_JWT_SECRET),
    tenantDb,
    queue,
    authAdmin,
    logger,
    authHookSecret: options.authHookSecret ?? null,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  return { app, tenantDb, queue, authAdmin, logger };
}

export function randomTenantId(): string {
  return randomUUID();
}
