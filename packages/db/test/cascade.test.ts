// カスケード削除の検証（決定 E4 / basic-design 8.2 / design-detail 6.1）。
// - list_entry 削除で deep_dive_jobs / collected_documents / dossiers / messages が消える
// - audit_logs は非 FK 参照のため削除後も残る（削除の事実の説明責任 — E4）
// - company_list 削除で配下の list_entries ごと消える
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectAs,
  seedSharedCompany,
  seedTenantFixture,
  withTenant,
  type TenantFixture,
} from "./helpers.js";

let appUser: Client;
let batch: Client;
let provisioner: Client;
let companyId: string;

beforeAll(async () => {
  batch = await connectAs("appBatch");
  appUser = await connectAs("appUser");
  provisioner = await connectAs("migrator");
  ({ companyId } = await seedSharedCompany(batch));
});

afterAll(async () => {
  await appUser.end();
  await batch.end();
  await provisioner.end();
});

async function countByEntry(
  client: Client,
  table: "deep_dive_jobs" | "collected_documents" | "dossiers" | "messages",
  listEntryId: string,
): Promise<number> {
  const result = await client.query<{ n: string }>(
    `select count(*)::text as n from ${table} where list_entry_id = $1`,
    [listEntryId],
  );
  return Number.parseInt(result.rows[0]?.n ?? "0", 10);
}

describe("ListEntry 起点のカスケード削除（E4）", () => {
  let fixture: TenantFixture;

  beforeAll(async () => {
    fixture = await seedTenantFixture(appUser, provisioner, companyId);
  });

  it("list_entry の削除で配下のテナント資産が全て消え、audit_logs は残る", async () => {
    await withTenant(appUser, fixture.tenantId, async (client) => {
      // 前提: 各テーブルに 1 行ずつある
      expect(await countByEntry(client, "deep_dive_jobs", fixture.listEntryId)).toBe(1);
      expect(await countByEntry(client, "collected_documents", fixture.listEntryId)).toBe(1);
      expect(await countByEntry(client, "dossiers", fixture.listEntryId)).toBe(1);
      expect(await countByEntry(client, "messages", fixture.listEntryId)).toBe(1);

      const deleted = await client.query(`delete from list_entries where id = $1`, [
        fixture.listEntryId,
      ]);
      expect(deleted.rowCount).toBe(1);

      expect(await countByEntry(client, "deep_dive_jobs", fixture.listEntryId)).toBe(0);
      expect(await countByEntry(client, "collected_documents", fixture.listEntryId)).toBe(0);
      expect(await countByEntry(client, "dossiers", fixture.listEntryId)).toBe(0);
      expect(await countByEntry(client, "messages", fixture.listEntryId)).toBe(0);

      // 監査ログ（resource_id = 削除済みエントリ）は非 FK のため残る
      const auditRows = await client.query(
        `select id from audit_logs where resource_id = $1 and event_type = 'deep_dive.started'`,
        [fixture.listEntryId],
      );
      expect(auditRows.rowCount).toBe(1);

      // テンプレート・企業リスト・共有資産の Company はエントリ削除の影響を受けない
      const template = await client.query(`select id from templates where id = $1`, [
        fixture.templateId,
      ]);
      expect(template.rowCount).toBe(1);
      const list = await client.query(`select id from company_lists where id = $1`, [
        fixture.companyListId,
      ]);
      expect(list.rowCount).toBe(1);
    });
    const company = await appUser.query(`select id from companies where id = $1`, [companyId]);
    expect(company.rowCount).toBe(1);
  });
});

describe("CompanyList 起点のカスケード削除", () => {
  let fixture: TenantFixture;

  beforeAll(async () => {
    fixture = await seedTenantFixture(appUser, provisioner, companyId);
  });

  it("company_list の削除で list_entries と配下が全て消える", async () => {
    await withTenant(appUser, fixture.tenantId, async (client) => {
      const deleted = await client.query(`delete from company_lists where id = $1`, [
        fixture.companyListId,
      ]);
      expect(deleted.rowCount).toBe(1);

      const entries = await client.query(`select id from list_entries where company_list_id = $1`, [
        fixture.companyListId,
      ]);
      expect(entries.rowCount).toBe(0);
      expect(await countByEntry(client, "dossiers", fixture.listEntryId)).toBe(0);
      expect(await countByEntry(client, "messages", fixture.listEntryId)).toBe(0);
      expect(await countByEntry(client, "deep_dive_jobs", fixture.listEntryId)).toBe(0);
      expect(await countByEntry(client, "collected_documents", fixture.listEntryId)).toBe(0);
    });
  });
});
