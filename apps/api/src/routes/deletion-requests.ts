// PII 削除（design-detail 2.2 POST /deletion-requests — 決定 E4: 即時物理削除・管理者のみ）。
// ListEntry 起点の ON DELETE CASCADE（20260714000300）を利用し、削除前に件数を数えて
// DeletionResponse で返す。監査ログ pii.deleted には削除の事実（scope・参照 ID・件数）のみを
// 残し、削除されたデータの内容は記録しない（E4 / 7.1）。
// 共有資産（companies / signals）内の PII はテナント API では扱わない（運用手順 — 2.2）。
import {
  deletionRequestSchema,
  deletionResponseSchema,
  type DeletionResponse,
} from "@is-reach/shared";
import type { Hono } from "hono";
import { recordAuditEvent } from "../audit/audit-log.js";
import { ApiHttpError } from "../errors.js";
import { registerRoute } from "../middleware/authorize.js";
import type { AppEnv } from "../types.js";
import type { TenantQuerier } from "../db/tenant-db.js";
import { parseDbContract, parseJsonBody } from "../validation.js";
import { resolveActor, type RouteDeps } from "./deps.js";

async function countForEntries(tx: TenantQuerier, entryIds: readonly string[]) {
  const [dossiers, messages, collectedDocuments] = [
    await tx.query<{ n: string }>(
      `select count(*)::text as n from dossiers where list_entry_id = any($1::uuid[])`,
      [entryIds],
    ),
    await tx.query<{ n: string }>(
      `select count(*)::text as n from messages where list_entry_id = any($1::uuid[])`,
      [entryIds],
    ),
    await tx.query<{ n: string }>(
      `select count(*)::text as n from collected_documents where list_entry_id = any($1::uuid[])`,
      [entryIds],
    ),
  ];
  return {
    dossiers: Number.parseInt(dossiers.rows[0]?.n ?? "0", 10),
    messages: Number.parseInt(messages.rows[0]?.n ?? "0", 10),
    collectedDocuments: Number.parseInt(collectedDocuments.rows[0]?.n ?? "0", 10),
    entries: entryIds.length,
  };
}

export function registerDeletionRequestRoutes(v1: Hono<AppEnv>, deps: RouteDeps): void {
  registerRoute(v1, "POST", "/deletion-requests", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const body = await parseJsonBody(c, deletionRequestSchema);

    const response = await deps.tenantDb.withTenantContext(
      auth.tenantId,
      async (tx): Promise<DeletionResponse> => {
        const actor = await resolveActor(tx, auth);

        let entryIds: string[];
        if (body.scope === "entry") {
          const entryId = body.entryId as string; // スキーマの superRefine で必須を保証済み
          const found = await tx.query<{ id: string }>(
            `select id from list_entries where id = $1`,
            [entryId],
          );
          if (found.rows.length === 0) {
            throw new ApiHttpError("RESOURCE_NOT_FOUND", "エントリが見つかりません");
          }
          entryIds = [entryId];
        } else {
          const companyId = body.companyId as string;
          const found = await tx.query<{ id: string }>(
            `select id from list_entries where company_id = $1`,
            [companyId],
          );
          if (found.rows.length === 0) {
            throw new ApiHttpError(
              "RESOURCE_NOT_FOUND",
              "この企業のテナント内データが見つかりません",
            );
          }
          entryIds = found.rows.map((row) => row.id);
        }

        // 削除前に件数を確定（CASCADE 後は数えられない）
        const deleted = await countForEntries(tx, entryIds);

        // ListEntry 起点の物理削除（Dossier・Message・収集データは CASCADE — E4）
        await tx.query(`delete from list_entries where id = any($1::uuid[])`, [entryIds]);

        // 削除の事実のみを記録（内容は残さない — E4）
        await recordAuditEvent(tx, {
          tenantId: auth.tenantId,
          actorUserId: actor.userId,
          eventType: "pii.deleted",
          resourceType: body.scope === "entry" ? "ListEntry" : "Company",
          resourceId: body.scope === "entry" ? (body.entryId ?? null) : (body.companyId ?? null),
          metadata: { scope: body.scope, reason: body.reason, deleted },
          requestId,
        });

        return parseDbContract(deletionResponseSchema, { deleted }, "DeletionResponse");
      },
    );
    return c.json(response);
  });
}
