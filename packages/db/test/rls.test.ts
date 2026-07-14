// RLS のテナント分離検証（design-detail 6.1 — 決定 E14 / pr-plan PR5a のテスト観点）。
// 1. fail-closed: app.tenant_id 未設定で全テナント資産テーブルが SELECT 0 行 / INSERT 拒否
// 2. 越境遮断: tenant A のコンテキストから tenant B の行を SELECT/UPDATE/DELETE できない
// 3. FORCE RLS: テーブル所有者（migrator）にもポリシーが効く
// 4. set_config(..., is_local = true) がトランザクション終了で消える（プーリング安全性）
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TENANT_TABLES } from "./context.js";
import {
  connectAs,
  countRows,
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
let tenantA: TenantFixture;
let tenantB: TenantFixture;

beforeAll(async () => {
  batch = await connectAs("appBatch");
  appUser = await connectAs("appUser");
  provisioner = await connectAs("migrator");
  const { companyId } = await seedSharedCompany(batch);
  tenantA = await seedTenantFixture(appUser, provisioner, companyId);
  tenantB = await seedTenantFixture(appUser, provisioner, companyId);
});

afterAll(async () => {
  await appUser.end();
  await batch.end();
  await provisioner.end();
});

describe("fail-closed（app.tenant_id 未設定）", () => {
  it("全テナント資産テーブルが SELECT 0 行になる", async () => {
    // シードと無関係の新規接続（set_config を一度も実行していない状態）
    const fresh = await connectAs("appUser");
    try {
      for (const table of TENANT_TABLES) {
        expect(await countRows(fresh, table), `${table} が fail-closed でない`).toBe(0);
      }
    } finally {
      await fresh.end();
    }
  });

  it("INSERT が RLS の WITH CHECK 違反で拒否される", async () => {
    const fresh = await connectAs("appUser");
    try {
      await expectPgError(
        fresh.query(
          `insert into templates (tenant_id, name, introduction, cta, tone, max_length)
           values ($1, 'コンテキストなし', 'x', 'y', 'z', 100)`,
          [tenantA.tenantId],
        ),
        INSUFFICIENT_PRIVILEGE,
        /row-level security/,
      );
      await expectPgError(
        fresh.query(
          `insert into company_lists (tenant_id, name, search_condition)
           values ($1, '越境リスト', '{}')`,
          [tenantA.tenantId],
        ),
        INSUFFICIENT_PRIVILEGE,
        /row-level security/,
      );
    } finally {
      await fresh.end();
    }
  });

  it("app.tenant_id が空文字でもキャストエラーにならず 0 行（nullif の fail-closed）", async () => {
    await withTenant(appUser, tenantA.tenantId, async (client) => {
      // withTenant の中で空文字へ上書き（トランザクション終了後に '' が残る挙動の再現）
      await client.query(`select set_config('app.tenant_id', '', true)`);
      expect(await countRows(client, "list_entries")).toBe(0);
    });
  });

  it("app.tenant_id が uuid 形式でない場合はクエリ自体がエラーになる（行は返らない）", async () => {
    await appUser.query("begin");
    try {
      await appUser.query(`select set_config('app.tenant_id', 'not-a-uuid', true)`);
      // 22P02 = invalid_text_representation（uuid キャスト失敗）。データ漏えいではなく失敗に倒れる
      await expectPgError(appUser.query(`select id from list_entries`), "22P02");
    } finally {
      await appUser.query("rollback");
    }
  });
});

describe("越境遮断（tenant A のコンテキストから tenant B へ）", () => {
  it("SELECT: B の行が見えず、全行スキャンでも A の行だけが見える", async () => {
    await withTenant(appUser, tenantA.tenantId, async (client) => {
      const byId = await client.query(`select id from company_lists where id = $1`, [
        tenantB.companyListId,
      ]);
      expect(byId.rowCount).toBe(0);

      const all = await client.query<{ tenant_id: string }>(
        `select distinct tenant_id from list_entries`,
      );
      expect(all.rows.map((row) => row.tenant_id)).toEqual([tenantA.tenantId]);
    });
  });

  it("UPDATE: B の行は対象にならない（0 行更新）", async () => {
    await withTenant(appUser, tenantA.tenantId, async (client) => {
      const updated = await client.query(`update list_entries set status = 'sent' where id = $1`, [
        tenantB.listEntryId,
      ]);
      expect(updated.rowCount).toBe(0);
    });
    // B 自身のコンテキストでは変わっていないことを確認
    await withTenant(appUser, tenantB.tenantId, async (client) => {
      const status = await client.query<{ status: string }>(
        `select status from list_entries where id = $1`,
        [tenantB.listEntryId],
      );
      expect(status.rows[0]?.status).toBe("not_started");
    });
  });

  it("DELETE: B の行は対象にならない（0 行削除）", async () => {
    await withTenant(appUser, tenantA.tenantId, async (client) => {
      const deleted = await client.query(`delete from messages where id = $1`, [tenantB.messageId]);
      expect(deleted.rowCount).toBe(0);
    });
    await withTenant(appUser, tenantB.tenantId, async (client) => {
      const remaining = await client.query(`select id from messages where id = $1`, [
        tenantB.messageId,
      ]);
      expect(remaining.rowCount).toBe(1);
    });
  });

  it("INSERT: A のコンテキストで tenant_id = B の行は作れない（WITH CHECK）", async () => {
    await withTenant(appUser, tenantA.tenantId, async (client) => {
      await expectPgError(
        client.query(
          `insert into templates (tenant_id, name, introduction, cta, tone, max_length)
           values ($1, 'なりすまし', 'x', 'y', 'z', 100)`,
          [tenantB.tenantId],
        ),
        INSUFFICIENT_PRIVILEGE,
        /row-level security/,
      );
    });
  });

  it("INSERT: tenant_id = A のまま B の親行を参照する行は作れない（複合 FK — 23503）", async () => {
    // FK の参照整合性チェックは RLS の対象外のため、単純 FK だとこの INSERT は成立して
    // しまう（存在プローブ + B 側削除カスケードでの越境破壊の経路）。(tenant_id, id) の
    // 複合 FK がテナント整合を強制することを検証する（レビュー should-fix 対応）。
    await withTenant(appUser, tenantA.tenantId, async (client) => {
      await expectPgError(
        client.query(`insert into deep_dive_jobs (tenant_id, list_entry_id) values ($1, $2)`, [
          tenantA.tenantId,
          tenantB.listEntryId,
        ]),
        "23503",
        /foreign key/,
      );
    });
  });
});

describe("FORCE RLS（テーブル所有者にも強制）", () => {
  it("全テナント資産テーブルで relforcerowsecurity が有効", async () => {
    const rows = await appUser.query<{ relname: string }>(
      `select relname from pg_class
       where relnamespace = 'public'::regnamespace
         and relkind = 'r' and relrowsecurity and relforcerowsecurity
       order by relname`,
    );
    expect(rows.rows.map((row) => row.relname).sort()).toEqual([...TENANT_TABLES].sort());
  });

  it("所有者（migrator・非スーパーユーザー）でもコンテキストなしでは 0 行", async () => {
    const owner = await connectAs("migrator");
    try {
      for (const table of TENANT_TABLES) {
        expect(await countRows(owner, table), `${table} で所有者が RLS を素通り`).toBe(0);
      }
      // コンテキストを設定すれば自テナント分だけ見える（ポリシー自体は機能する）
      await withTenant(owner, tenantA.tenantId, async (client) => {
        const rows = await client.query<{ tenant_id: string }>(
          `select distinct tenant_id from list_entries`,
        );
        expect(rows.rows.map((row) => row.tenant_id)).toEqual([tenantA.tenantId]);
      });
    } finally {
      await owner.end();
    }
  });
});

describe("set_config のトランザクションスコープ（プーリング安全性 — E14）", () => {
  it("トランザクション終了後は同一接続でも全行不可に戻る", async () => {
    await withTenant(appUser, tenantA.tenantId, async (client) => {
      expect(await countRows(client, "company_lists")).toBeGreaterThan(0);
    });
    // 同じ接続・トランザクション外: 設定は消えている（NULL または ''）
    const unset = await appUser.query<{ unset: boolean }>(
      `select nullif(current_setting('app.tenant_id', true), '') is null as unset`,
    );
    expect(unset.rows[0]?.unset).toBe(true);
    expect(await countRows(appUser, "company_lists")).toBe(0);
  });

  it("rollback でも設定が残らない", async () => {
    await appUser.query("begin");
    await appUser.query(`select set_config('app.tenant_id', $1, true)`, [tenantA.tenantId]);
    await appUser.query("rollback");
    expect(await countRows(appUser, "company_lists")).toBe(0);
  });
});
