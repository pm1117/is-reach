// データアクセス層（E14 のアプリ側）のテスト。
// モック接続で「トランザクションで包み、先頭で set_config('app.tenant_id', $1, true)」の
// 規約を検証する（実 DB での RLS 検証は packages/db の pnpm test:db 側の責務）。
import type { QueryResult } from "pg";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  createTenantDbFromPool,
  type MinimalPool,
  type MinimalPoolClient,
} from "../src/db/tenant-db.js";
import { TEST_TENANT_ID } from "./helpers.js";

const EMPTY_RESULT = {
  rows: [],
  rowCount: 0,
  command: "",
  oid: 0,
  fields: [],
} as unknown as QueryResult;

class FakeClient implements MinimalPoolClient {
  readonly queries: { text: string; values: unknown[] | undefined }[] = [];
  releasedWith: boolean | undefined;
  failOnText: string | undefined;
  rollbackFails = false;

  async query(text: string, values?: unknown[]): Promise<QueryResult> {
    if (text === "rollback" && this.rollbackFails) {
      throw new Error("接続断で rollback 失敗");
    }
    this.queries.push({ text, values });
    if (this.failOnText !== undefined && text === this.failOnText) {
      throw new Error(`クエリ失敗: ${text}`);
    }
    return EMPTY_RESULT;
  }

  release(destroy?: boolean): void {
    this.releasedWith = destroy ?? false;
  }
}

class FakePool implements MinimalPool {
  readonly client = new FakeClient();
  connectCount = 0;
  ended = false;

  async connect(): Promise<MinimalPoolClient> {
    this.connectCount += 1;
    return this.client;
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

describe("TenantDb.withTenantContext（RLS 接続規約 — design-detail 6.1）", () => {
  it("begin → set_config('app.tenant_id', $1, true) → 業務クエリ → commit の順で実行される", async () => {
    const pool = new FakePool();
    const db = createTenantDbFromPool(pool);

    const result = await db.withTenantContext(TEST_TENANT_ID, async (tx) => {
      await tx.query("select * from company_lists", []);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(pool.client.queries.map((q) => q.text)).toEqual([
      "begin",
      "select set_config('app.tenant_id', $1, true)",
      "select * from company_lists",
      "commit",
    ]);
    // tenant_id はプレースホルダ経由（SQL 文字列へ連結しない）
    expect(pool.client.queries[1]?.values).toEqual([TEST_TENANT_ID]);
    expect(pool.client.releasedWith).toBe(false); // プールへ返却
  });

  it("fn 内のクエリはすべて同一クライアント（同一トランザクション）で実行される", async () => {
    const pool = new FakePool();
    const db = createTenantDbFromPool(pool);
    await db.withTenantContext(TEST_TENANT_ID, async (tx) => {
      await tx.query("select 1");
      await tx.query("select 2");
    });
    expect(pool.connectCount).toBe(1);
    expect(pool.client.queries.map((q) => q.text)).toContain("select 1");
    expect(pool.client.queries.map((q) => q.text)).toContain("select 2");
  });

  it("fn が throw したら rollback して例外を再送出し、接続を返却する", async () => {
    const pool = new FakePool();
    const db = createTenantDbFromPool(pool);

    await expect(
      db.withTenantContext(TEST_TENANT_ID, async () => {
        throw new Error("業務エラー");
      }),
    ).rejects.toThrowError("業務エラー");

    expect(pool.client.queries.map((q) => q.text)).toEqual([
      "begin",
      "select set_config('app.tenant_id', $1, true)",
      "rollback",
    ]);
    expect(pool.client.releasedWith).toBe(false);
  });

  it("業務クエリの失敗も rollback される", async () => {
    const pool = new FakePool();
    pool.client.failOnText = "insert into templates";
    const db = createTenantDbFromPool(pool);

    await expect(
      db.withTenantContext(TEST_TENANT_ID, (tx) => tx.query("insert into templates")),
    ).rejects.toThrowError(/クエリ失敗/);
    expect(pool.client.queries.at(-1)?.text).toBe("rollback");
  });

  it("rollback 自体が失敗（接続断）した場合は接続を破棄して元の例外を投げる", async () => {
    const pool = new FakePool();
    pool.client.rollbackFails = true;
    const db = createTenantDbFromPool(pool);

    await expect(
      db.withTenantContext(TEST_TENANT_ID, async () => {
        throw new Error("業務エラー");
      }),
    ).rejects.toThrowError("業務エラー");
    expect(pool.client.releasedWith).toBe(true); // destroy = true でプールへ戻さない
  });

  it("UUID でない tenantId は接続確保前に拒否する（fail-closed）", async () => {
    const pool = new FakePool();
    const db = createTenantDbFromPool(pool);
    await expect(
      db.withTenantContext("'; drop table tenants; --", async () => "unreachable"),
    ).rejects.toThrowError(ZodError);
    expect(pool.connectCount).toBe(0);
  });

  it("end() がプールを終了する", async () => {
    const pool = new FakePool();
    const db = createTenantDbFromPool(pool);
    await db.end();
    expect(pool.ended).toBe(true);
  });
});
