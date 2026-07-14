// マイグレーションの再現性検証（pr-plan PR5a 受け入れ条件: 空 DB から再現可能）。
// globalSetup が 1 回目の適用に相当するため、ここでは同一クラスタ内の別の空 DB へ
// もう一度適用できること（ロール作成の冪等性を含む）と、適用後のカタログ状態を検証する。
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { TENANT_TABLES } from "./context.js";
import { applyMigrations } from "./migrate.js";
import { connectAs, dbContext } from "./helpers.js";

describe("マイグレーションの再現性", () => {
  it("別の空 DB へ順に再適用できる（ロールは冪等に共存）", async () => {
    const ctx = dbContext();
    const admin = await connectAs("superuser", "postgres");
    try {
      // app_user / app_batch ロールは 1 回目の適用で作成済み → 2 回目は冪等にスキップされる
      await admin.query(`create database is_reach_test_repro owner ${ctx.migrator.user}`);
    } finally {
      await admin.end();
    }

    const migrator = new Client({
      host: ctx.host,
      port: ctx.port,
      database: "is_reach_test_repro",
      user: ctx.migrator.user,
      password: ctx.migrator.password,
    });
    await migrator.connect();
    try {
      const applied = await applyMigrations(migrator);
      expect(applied.length).toBeGreaterThanOrEqual(6);

      // テナント資産 10 + 共有資産 2 = 12 テーブル
      const tables = await migrator.query<{ relname: string }>(
        `select relname from pg_class
         where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`,
      );
      expect(tables.rowCount).toBe(12);

      // 全テナント資産テーブルに ENABLE + FORCE RLS と tenant_isolation ポリシー
      const rls = await migrator.query<{ relname: string }>(
        `select relname from pg_class
         where relnamespace = 'public'::regnamespace and relkind = 'r'
           and relrowsecurity and relforcerowsecurity order by relname`,
      );
      expect(rls.rows.map((row) => row.relname).sort()).toEqual([...TENANT_TABLES].sort());

      const policies = await migrator.query<{ tablename: string; policyname: string }>(
        `select tablename, policyname from pg_policies where schemaname = 'public'`,
      );
      expect(policies.rowCount).toBe(TENANT_TABLES.length);
      expect(policies.rows.every((row) => row.policyname === "tenant_isolation")).toBe(true);

      // pgboss スキーマが存在する（E1）
      const pgboss = await migrator.query(
        `select nspname from pg_namespace where nspname = 'pgboss'`,
      );
      expect(pgboss.rowCount).toBe(1);
    } finally {
      await migrator.end();
    }
  });
});
