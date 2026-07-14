// メッセージ（design-detail 2.2 — 要件 F4 / F5 / 決定 E13）。
// - POST /entries/:entryId/messages: 生成ジョブ投入 → 202（非同期 + ポーリング）
// - GET /message-jobs/:jobId: ジョブ状態（message_jobs — 20260714000700）
// - GET/PATCH /messages/:messageId・GET /entries/:entryId/messages・copy-events
import {
  generateMessageRequestSchema,
  messageJobSchema,
  messageSchema,
  paginationQuerySchema,
  updateMessageRequestSchema,
  type Message,
  type MessageJob,
} from "@is-reach/shared";
import type { Hono } from "hono";
import { recordAuditEvent } from "../audit/audit-log.js";
import { ApiHttpError } from "../errors.js";
import { registerRoute } from "../middleware/authorize.js";
import { JobNotEnqueuedError } from "../queue/pg-boss-queue.js";
import type { AppEnv } from "../types.js";
import {
  parseDbContract,
  parseJsonBody,
  parseQuery,
  parseUuidParam,
  toIso,
} from "../validation.js";
import { resolveActor, type RouteDeps } from "./deps.js";

export interface MessageJobRow {
  id: string;
  list_entry_id: string;
  state: string;
  message_id: string | null;
  error: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

export const MESSAGE_JOB_SELECT = `
  select id, list_entry_id, state, message_id, error, created_at, updated_at
    from message_jobs`;

export function toMessageJob(row: MessageJobRow): MessageJob {
  return parseDbContract(
    messageJobSchema,
    {
      id: row.id,
      listEntryId: row.list_entry_id,
      state: row.state,
      messageId: row.message_id,
      error: row.error,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    },
    "message_jobs 行",
  );
}

export interface MessageRow {
  id: string;
  list_entry_id: string;
  template_id: string | null;
  dossier_id: string;
  parts: unknown;
  assembled_body: string;
  edited_body: string | null;
  validation: unknown;
  model_id: string;
  generated_at: Date | string;
  edited_at: Date | string | null;
}

export const MESSAGE_SELECT = `
  select id, list_entry_id, template_id, dossier_id, parts, assembled_body,
         edited_body, validation, model_id, generated_at, edited_at
    from messages`;

export function toMessage(row: MessageRow): Message {
  return parseDbContract(
    messageSchema,
    {
      id: row.id,
      listEntryId: row.list_entry_id,
      templateId: row.template_id,
      dossierId: row.dossier_id,
      parts: row.parts,
      assembledBody: row.assembled_body,
      editedBody: row.edited_body,
      validation: row.validation,
      modelId: row.model_id,
      generatedAt: toIso(row.generated_at),
      editedAt: row.edited_at === null ? null : toIso(row.edited_at),
    },
    "messages 行",
  );
}

/** pg-boss の多重投入防止キー（1 エントリあたり同時生成 1 — JOB_ALREADY_RUNNING） */
export function generateMessageSingletonKey(entryId: string): string {
  return `generate_message:${entryId}`;
}

export function registerMessageRoutes(v1: Hono<AppEnv>, deps: RouteDeps): void {
  registerRoute(v1, "POST", "/entries/:entryId/messages", async (c) => {
    const auth = c.get("auth");
    const entryId = parseUuidParam(c, "entryId");
    const body = await parseJsonBody(c, generateMessageRequestSchema);

    const jobId = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);

      const entry = await tx.query(`select id from list_entries where id = $1`, [entryId]);
      if (entry.rows.length === 0) {
        throw new ApiHttpError("RESOURCE_NOT_FOUND", "エントリが見つかりません");
      }
      const template = await tx.query(`select id from templates where id = $1`, [body.templateId]);
      if (template.rows.length === 0) {
        throw new ApiHttpError("RESOURCE_NOT_FOUND", "テンプレートが見つかりません");
      }
      // 生成にはドシエが必要（F4 は F3 に依存 — basic-design 4.1 の一本道）
      const dossier = await tx.query(`select id from dossiers where list_entry_id = $1`, [entryId]);
      if (dossier.rows.length === 0) {
        throw new ApiHttpError(
          "RESOURCE_CONFLICT",
          "ドシエが未生成です。先に深掘りを実行してください",
        );
      }
      const running = await tx.query(
        `select id from message_jobs
          where list_entry_id = $1 and state in ('queued', 'generating')`,
        [entryId],
      );
      if (running.rows.length > 0) {
        throw new ApiHttpError("JOB_ALREADY_RUNNING", "実行中のメッセージ生成ジョブがあります");
      }

      const inserted = await tx.query<{ id: string }>(
        `insert into message_jobs (tenant_id, list_entry_id, template_id, created_by)
         values ($1, $2, $3, $4) returning id`,
        [auth.tenantId, entryId, body.templateId, actor.userId],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("message_jobs の INSERT が行を返しません");

      try {
        await deps.queue.enqueue(
          "generate_message",
          { messageJobId: row.id, tenantId: auth.tenantId },
          { singletonKey: generateMessageSingletonKey(entryId), groupKey: auth.tenantId },
        );
      } catch (error) {
        if (error instanceof JobNotEnqueuedError) {
          throw new ApiHttpError("JOB_ALREADY_RUNNING", "実行中のメッセージ生成ジョブがあります");
        }
        throw error;
      }
      return row.id;
    });

    return c.json({ jobId }, 202);
  });

  registerRoute(v1, "GET", "/message-jobs/:jobId", async (c) => {
    const auth = c.get("auth");
    const jobId = parseUuidParam(c, "jobId");
    const row = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const result = await tx.query<MessageJobRow>(`${MESSAGE_JOB_SELECT} where id = $1`, [jobId]);
      return result.rows[0];
    });
    if (row === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "ジョブが見つかりません");
    }
    return c.json(toMessageJob(row));
  });

  registerRoute(v1, "GET", "/entries/:entryId/messages", async (c) => {
    const auth = c.get("auth");
    const entryId = parseUuidParam(c, "entryId");
    const page = parseQuery(c, paginationQuerySchema);
    const result = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const entry = await tx.query(`select id from list_entries where id = $1`, [entryId]);
      if (entry.rows.length === 0) return undefined;
      const total = await tx.query<{ n: string }>(
        `select count(*)::text as n from messages where list_entry_id = $1`,
        [entryId],
      );
      const rows = await tx.query<MessageRow>(
        `${MESSAGE_SELECT} where list_entry_id = $1
          order by generated_at desc, id limit $2 offset $3`,
        [entryId, page.limit, page.offset],
      );
      return {
        items: rows.rows.map(toMessage),
        total: Number.parseInt(total.rows[0]?.n ?? "0", 10),
      };
    });
    if (result === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "エントリが見つかりません");
    }
    return c.json(result);
  });

  registerRoute(v1, "GET", "/messages/:messageId", async (c) => {
    const auth = c.get("auth");
    const messageId = parseUuidParam(c, "messageId");
    const row = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const result = await tx.query<MessageRow>(`${MESSAGE_SELECT} where id = $1`, [messageId]);
      return result.rows[0];
    });
    if (row === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "メッセージが見つかりません");
    }
    return c.json(toMessage(row));
  });

  registerRoute(v1, "PATCH", "/messages/:messageId", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const messageId = parseUuidParam(c, "messageId");
    const body = await parseJsonBody(c, updateMessageRequestSchema);

    const row = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      const updated = await tx.query<MessageRow>(
        `update messages set edited_body = $2, edited_at = now() where id = $1
         returning id, list_entry_id, template_id, dossier_id, parts, assembled_body,
                   edited_body, validation, model_id, generated_at, edited_at`,
        [messageId, body.editedBody],
      );
      const message = updated.rows[0];
      if (message === undefined) return undefined;
      await recordAuditEvent(tx, {
        tenantId: auth.tenantId,
        actorUserId: actor.userId,
        eventType: "message.edited",
        resourceType: "Message",
        resourceId: messageId,
        metadata: { length: body.editedBody.length },
        requestId,
      });
      return message;
    });
    if (row === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "メッセージが見つかりません");
    }
    return c.json(toMessage(row));
  });

  registerRoute(v1, "POST", "/messages/:messageId/copy-events", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const messageId = parseUuidParam(c, "messageId");

    const found = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      const result = await tx.query<MessageRow>(`${MESSAGE_SELECT} where id = $1`, [messageId]);
      const message = result.rows[0];
      if (message === undefined) return false;
      const contract = toMessage(message);
      // 警告付きメッセージのコピーか否かを記録（design-detail 3.5 / 7.1）
      await recordAuditEvent(tx, {
        tenantId: auth.tenantId,
        actorUserId: actor.userId,
        eventType: "message.copied",
        resourceType: "Message",
        resourceId: messageId,
        metadata: {
          warned: contract.validation.warnings.length > 0,
          warningCodes: contract.validation.warnings.map((warning) => warning.code),
          copiedEdited: contract.editedBody !== null,
        },
        requestId,
      });
      return true;
    });
    if (!found) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "メッセージが見つかりません");
    }
    return c.body(null, 204);
  });
}
