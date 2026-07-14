// 権限の検証（design-detail 6.1 — 決定 E14 / basic-design 7.2）。
// - audit_logs は追記専用: app_user の UPDATE / DELETE が権限エラー
// - 共有資産: app_user は SELECT のみ（INSERT/UPDATE/DELETE 不可）、app_batch は書き込み可
// - app_batch はテナント資産へアクセスできない / app_user は pgboss スキーマへアクセスできない
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectAs,
  expectPgError,
  INSUFFICIENT_PRIVILEGE,
  seedSharedCompany,
  seedTenantFixture,
  withTenant,
  type TenantFixture,
} from "./helpers.js";

let appUser: Client;
let batch: Client;
let provisioner: Client;
let companyId: string;
let fixture: TenantFixture;

beforeAll(async () => {
  batch = await connectAs("appBatch");
  appUser = await connectAs("appUser");
  provisioner = await connectAs("migrator");
  ({ companyId } = await seedSharedCompany(batch));
  fixture = await seedTenantFixture(appUser, provisioner, companyId);
});

afterAll(async () => {
  await appUser.end();
  await batch.end();
  await provisioner.end();
});

describe("audit_logs の追記専用（権限で強制 — E14/E16）", () => {
  it("app_user は自テナントの行でも UPDATE できない（permission denied）", async () => {
    await withTenant(appUser, fixture.tenantId, async (client) => {
      await expectPgError(
        client.query(`update audit_logs set metadata = '{}' where id = $1`, [fixture.auditLogId]),
        INSUFFICIENT_PRIVILEGE,
        /permission denied/,
      );
    });
  });

  it("app_user は自テナントの行でも DELETE できない（permission denied）", async () => {
    await withTenant(appUser, fixture.tenantId, async (client) => {
      await expectPgError(
        client.query(`delete from audit_logs where id = $1`, [fixture.auditLogId]),
        INSUFFICIENT_PRIVILEGE,
        /permission denied/,
      );
    });
  });

  it("app_user は INSERT / SELECT はできる", async () => {
    await withTenant(appUser, fixture.tenantId, async (client) => {
      await client.query(
        `insert into audit_logs (tenant_id, actor_user_id, event_type)
         values ($1, $2, 'dossier.viewed')`,
        [fixture.tenantId, fixture.userId],
      );
      const rows = await client.query(`select id from audit_logs where tenant_id = $1`, [
        fixture.tenantId,
      ]);
      expect(rows.rowCount).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("共有資産（companies / signals）の権限", () => {
  it("app_user は SELECT できる", async () => {
    const companies = await appUser.query(`select id from companies where id = $1`, [companyId]);
    expect(companies.rowCount).toBe(1);
    const signals = await appUser.query(`select id from signals where company_id = $1`, [
      companyId,
    ]);
    expect(signals.rowCount).toBeGreaterThanOrEqual(1);
  });

  it("app_user は INSERT / UPDATE / DELETE できない（permission denied）", async () => {
    await expectPgError(
      appUser.query(`insert into companies (name) values ('不正な書き込み')`),
      INSUFFICIENT_PRIVILEGE,
      /permission denied/,
    );
    await expectPgError(
      appUser.query(`update companies set name = '改ざん' where id = $1`, [companyId]),
      INSUFFICIENT_PRIVILEGE,
      /permission denied/,
    );
    await expectPgError(
      appUser.query(`delete from companies where id = $1`, [companyId]),
      INSUFFICIENT_PRIVILEGE,
      /permission denied/,
    );
    await expectPgError(
      appUser.query(
        `insert into signals (company_id, kind, summary, source_url, collected_at)
         values ($1, 'tech_blog', 'x', 'https://example.co.jp/blog/1', now())`,
        [companyId],
      ),
      INSUFFICIENT_PRIVILEGE,
      /permission denied/,
    );
  });

  it("app_batch は INSERT / UPDATE / DELETE できる", async () => {
    const inserted = await batch.query<{ id: string }>(
      `insert into companies (name) values ('バッチ書き込み') returning id`,
    );
    const id = inserted.rows[0]?.id;
    expect(id).toBeDefined();
    const updated = await batch.query(`update companies set industry = 'saas' where id = $1`, [id]);
    expect(updated.rowCount).toBe(1);
    const deleted = await batch.query(`delete from companies where id = $1`, [id]);
    expect(deleted.rowCount).toBe(1);
  });
});

describe("ロール分離の境界", () => {
  it("app_batch はテナント資産へアクセスできない（permission denied）", async () => {
    await expectPgError(
      batch.query(`select id from list_entries`),
      INSUFFICIENT_PRIVILEGE,
      /permission denied/,
    );
    await expectPgError(
      batch.query(`select id from audit_logs`),
      INSUFFICIENT_PRIVILEGE,
      /permission denied/,
    );
  });

  it("pgboss スキーマは app_batch のみ USAGE/CREATE 可、app_user は不可", async () => {
    const privileges = await appUser.query<{
      role: string;
      usage: boolean;
      create: boolean;
    }>(
      `select r.rolname as role,
              has_schema_privilege(r.rolname, 'pgboss', 'usage') as usage,
              has_schema_privilege(r.rolname, 'pgboss', 'create') as create
       from pg_roles r where r.rolname in ('app_user', 'app_batch') order by r.rolname`,
    );
    expect(privileges.rows).toEqual([
      { role: "app_batch", usage: true, create: true },
      { role: "app_user", usage: false, create: false },
    ]);
  });

  it("app_user / app_batch は非スーパーユーザーかつ BYPASSRLS なし", async () => {
    const roles = await appUser.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `select rolname, rolsuper, rolbypassrls from pg_roles
       where rolname in ('app_user', 'app_batch') order by rolname`,
    );
    expect(roles.rows).toEqual([
      { rolname: "app_batch", rolsuper: false, rolbypassrls: false },
      { rolname: "app_user", rolsuper: false, rolbypassrls: false },
    ]);
  });
});
