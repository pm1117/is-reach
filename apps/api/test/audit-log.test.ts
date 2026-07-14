// 監査ログ記録（E16 / design-detail 7.2）のテスト。
// フェイク TenantQuerier で INSERT の列対応・入力検証・既定値を検証する
// （追記専用の DB 権限検証は packages/db の test:db 側の責務）。
import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { recordAuditEvent } from "../src/audit/audit-log.js";
import type { TenantQuerier } from "../src/db/tenant-db.js";
import { TEST_TENANT_ID, TEST_USER_ID } from "./helpers.js";

const RESOURCE_ID = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";

class RecordingQuerier implements TenantQuerier {
  readonly queries: { text: string; values: readonly unknown[] | undefined }[] = [];

  async query<R extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>> {
    this.queries.push({ text, values });
    return {
      rows: [],
      rowCount: 1,
      command: "INSERT",
      oid: 0,
      fields: [],
    } as unknown as QueryResult<R>;
  }
}

describe("recordAuditEvent（7.2 の記録属性）", () => {
  it("全属性を audit_logs へ INSERT する（列順どおりのパラメータ）", async () => {
    const tx = new RecordingQuerier();
    await recordAuditEvent(tx, {
      tenantId: TEST_TENANT_ID,
      actorUserId: TEST_USER_ID,
      eventType: "deep_dive.started",
      resourceType: "ListEntry",
      resourceId: RESOURCE_ID,
      metadata: { jobCount: 3 },
      requestId: "req-123",
    });

    expect(tx.queries).toHaveLength(1);
    const [query] = tx.queries;
    expect(query?.text).toMatch(/insert into audit_logs/);
    expect(query?.text).toMatch(
      /tenant_id, actor_user_id, event_type, resource_type, resource_id, metadata, request_id/,
    );
    expect(query?.values).toEqual([
      TEST_TENANT_ID,
      TEST_USER_ID,
      "deep_dive.started",
      "ListEntry",
      RESOURCE_ID,
      JSON.stringify({ jobCount: 3 }),
      "req-123",
    ]);
  });

  it("省略可能な属性は null / 空 metadata が既定になる", async () => {
    const tx = new RecordingQuerier();
    await recordAuditEvent(tx, {
      tenantId: TEST_TENANT_ID,
      actorUserId: null, // システム起因等
      eventType: "screening.searched",
    });
    expect(tx.queries[0]?.values).toEqual([
      TEST_TENANT_ID,
      null,
      "screening.searched",
      null,
      null,
      JSON.stringify({}),
      null,
    ]);
  });

  it("7.1 にないイベント種別を拒否する（INSERT に到達しない）", async () => {
    const tx = new RecordingQuerier();
    await expect(
      recordAuditEvent(tx, {
        tenantId: TEST_TENANT_ID,
        actorUserId: null,
        eventType: "user.deleted" as never,
      }),
    ).rejects.toThrowError(ZodError);
    expect(tx.queries).toHaveLength(0);
  });

  it("UUID でない tenantId / resourceId を拒否する", async () => {
    const tx = new RecordingQuerier();
    await expect(
      recordAuditEvent(tx, {
        tenantId: "not-a-uuid",
        actorUserId: null,
        eventType: "list.created",
      }),
    ).rejects.toThrowError(ZodError);
    await expect(
      recordAuditEvent(tx, {
        tenantId: TEST_TENANT_ID,
        actorUserId: null,
        eventType: "list.created",
        resourceId: "not-a-uuid",
      }),
    ).rejects.toThrowError(ZodError);
    expect(tx.queries).toHaveLength(0);
  });
});
