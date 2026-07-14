// DB テスト共通ヘルパー: ロール別接続・テナントコンテキスト・シード・エラー検証。
import { randomUUID } from "node:crypto";
import { Client, DatabaseError } from "pg";
import { expect, inject } from "vitest";
import type { DbTestContext, SharedTable, TenantTable } from "./context.js";

export function dbContext(): DbTestContext {
  return inject("dbtest");
}

export type RoleName = "appUser" | "appBatch" | "migrator" | "superuser";

/** 指定ロールでテスト DB へ接続する。呼び出し側が必ず end() すること（afterAll 等） */
export async function connectAs(role: RoleName, database?: string): Promise<Client> {
  const ctx = dbContext();
  const client = new Client({
    host: ctx.host,
    port: ctx.port,
    database: database ?? ctx.database,
    user: ctx[role].user,
    password: ctx[role].password,
  });
  await client.connect();
  return client;
}

/**
 * E14 のデータアクセス規約と同じ形でテナントコンテキストを設定して fn を実行する:
 * トランザクション先頭で set_config('app.tenant_id', <uuid>, true)（SET LOCAL 相当）を
 * 実行し、テナント文脈のクエリを同一トランザクション内で完結させる。
 */
export async function withTenant<T>(
  client: Client,
  tenantId: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

/** promise が Postgres エラー（指定 SQLSTATE + メッセージ）で失敗することを検証する */
export async function expectPgError(
  promise: Promise<unknown>,
  code: string,
  messagePattern?: RegExp,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, `Postgres エラー（SQLSTATE ${code}）になるべきクエリが成功した`).toBeDefined();
  expect(caught).toBeInstanceOf(DatabaseError);
  const dbError = caught as DatabaseError;
  expect(dbError.code).toBe(code);
  if (messagePattern !== undefined) {
    expect(dbError.message).toMatch(messagePattern);
  }
}

/** SQLSTATE 42501 = insufficient_privilege（権限エラー・RLS の WITH CHECK 違反の両方） */
export const INSUFFICIENT_PRIVILEGE = "42501";

/** 共有資産のシード（app_batch で実行する前提）。company と signal を 1 件ずつ作る */
export async function seedSharedCompany(batch: Client): Promise<{ companyId: string }> {
  const companyResult = await batch.query<{ id: string }>(
    `insert into companies (name, domain, industry, employee_range, region)
     values ('テスト株式会社', 'example.co.jp', 'software', '51-100', 'tokyo')
     returning id`,
  );
  const companyId = companyResult.rows[0]?.id;
  if (companyId === undefined) throw new Error("companies のシードに失敗");
  await batch.query(
    `insert into signals (company_id, kind, summary, attributes, source_url, collected_at)
     values ($1, 'job_posting', 'React エンジニア募集', '{"keywords":["React"]}',
             'https://example.co.jp/careers/1', now())`,
    [companyId],
  );
  return { companyId };
}

/** 1 テナント分のフィクスチャ（全テナント資産テーブルに 1 行以上） */
export interface TenantFixture {
  tenantId: string;
  userId: string;
  companyListId: string;
  listEntryId: string;
  deepDiveJobId: string;
  collectedDocumentId: string;
  dossierId: string;
  templateId: string;
  messageId: string;
  auditLogId: string;
}

async function insertReturningId(client: Client, sql: string, values: unknown[]): Promise<string> {
  const result = await client.query<{ id: string }>(sql, values);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`INSERT が id を返さない: ${sql}`);
  return id;
}

/**
 * テナント一式をシードする。tenant_id はクライアント生成の UUID。
 * - tenants 行の作成のみ provisioner（テストでは所有者 migrator = 運用側の代役）で行う。
 *   app_user には tenants への INSERT / DELETE 権限がない（監査ログのカスケード消去
 *   経路を塞ぐレビュー must-fix 対応 — 20260714000400 参照）。
 * - 残りは app_user 接続で INSERT する（RLS の WITH CHECK を通る書き込み経路の検証を兼ねる）。
 */
export async function seedTenantFixture(
  appUser: Client,
  provisioner: Client,
  companyId: string,
): Promise<TenantFixture> {
  const tenantId = randomUUID();
  await withTenant(provisioner, tenantId, async (client) => {
    await client.query(`insert into tenants (id, name) values ($1, $2)`, [
      tenantId,
      `テナント ${tenantId}`,
    ]);
  });
  return withTenant(appUser, tenantId, async (client) => {
    const userId = await insertReturningId(
      client,
      `insert into users (tenant_id, email, display_name, role, invitation_status)
       values ($1, $2, '担当者', 'admin', 'active') returning id`,
      [tenantId, `admin+${tenantId}@example.com`],
    );
    const companyListId = await insertReturningId(
      client,
      `insert into company_lists (tenant_id, name, search_condition, created_by)
       values ($1, 'テストリスト', '{"signals":{"kinds":["job_posting"]}}', $2) returning id`,
      [tenantId, userId],
    );
    const listEntryId = await insertReturningId(
      client,
      `insert into list_entries (tenant_id, company_list_id, company_id, match_evidence, assignee_id)
       values ($1, $2, $3, '[{"kind":"job_posting"}]', $4) returning id`,
      [tenantId, companyListId, companyId, userId],
    );
    const deepDiveJobId = await insertReturningId(
      client,
      `insert into deep_dive_jobs (tenant_id, list_entry_id, state, progress_fetched_pages)
       values ($1, $2, 'done', 3) returning id`,
      [tenantId, listEntryId],
    );
    await client.query(`update list_entries set latest_deep_dive_job_id = $2 where id = $1`, [
      listEntryId,
      deepDiveJobId,
    ]);
    const collectedDocumentId = await insertReturningId(
      client,
      `insert into collected_documents (tenant_id, list_entry_id, source_url, fetched_at, kind, title, body)
       values ($1, $2, 'https://example.co.jp/about', now(), 'corporate_site', '会社概要', '本文')
       returning id`,
      [tenantId, listEntryId],
    );
    const dossierId = await insertReturningId(
      client,
      `insert into dossiers (tenant_id, list_entry_id, business_summary, model_id)
       values ($1, $2,
               '{"body":"事業サマリ","evidence":{"kind":"sources","urls":["https://example.co.jp/about"]}}',
               'claude-sonnet-test') returning id`,
      [tenantId, listEntryId],
    );
    const templateId = await insertReturningId(
      client,
      `insert into templates (tenant_id, name, introduction, cta, tone, max_length, created_by)
       values ($1, '標準テンプレート', '自社紹介', 'CTA', 'polite', 600, $2) returning id`,
      [tenantId, userId],
    );
    const messageId = await insertReturningId(
      client,
      `insert into messages (tenant_id, list_entry_id, template_id, dossier_id, parts,
                             assembled_body, validation, model_id)
       values ($1, $2, $3, $4,
               '{"hook":"h","issueMention":"i","introduction":"自社紹介","cta":"CTA"}',
               '本文全体', '{"ok":true,"warnings":[]}', 'claude-haiku-test') returning id`,
      [tenantId, listEntryId, templateId, dossierId],
    );
    const auditLogId = await insertReturningId(
      client,
      `insert into audit_logs (tenant_id, actor_user_id, event_type, resource_type, resource_id, metadata)
       values ($1, $2, 'deep_dive.started', 'ListEntry', $3, '{"jobCount":1}') returning id`,
      [tenantId, userId, listEntryId],
    );
    return {
      tenantId,
      userId,
      companyListId,
      listEntryId,
      deepDiveJobId,
      collectedDocumentId,
      dossierId,
      templateId,
      messageId,
      auditLogId,
    };
  });
}

/** テーブルの可視行数（現在のコンテキストで）。識別子は既知テーブル名の型に固定する */
export async function countRows(client: Client, table: TenantTable | SharedTable): Promise<number> {
  const result = await client.query<{ n: string }>(`select count(*)::text as n from ${table}`);
  return Number.parseInt(result.rows[0]?.n ?? "0", 10);
}
