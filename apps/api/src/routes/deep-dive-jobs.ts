// 深掘りジョブ（design-detail 2.2 — 要件 F2 / 決定 E9）。
// - POST /deep-dive-jobs: 複数エントリのジョブ投入 → 202。実行中エントリへの再投入は
//   JOB_ALREADY_RUNNING(409)。多重投入は DB チェック + pg-boss singletonKey の二重で防ぐ。
// - GET /deep-dive-jobs/:jobId: ポーリング用の状態取得。
// - POST /deep-dive-jobs/:jobId/retry: failed → queued のみ許可（4.1）。
import {
  createDeepDiveJobsRequestSchema,
  deepDiveJobSchema,
  type DeepDiveJob,
} from "@is-reach/shared";
import type { Hono } from "hono";
import { recordAuditEvent } from "../audit/audit-log.js";
import { ApiHttpError } from "../errors.js";
import { registerRoute } from "../middleware/authorize.js";
import { JobNotEnqueuedError } from "../queue/pg-boss-queue.js";
import type { AppEnv } from "../types.js";
import { parseDbContract, parseJsonBody, parseUuidParam, toIso } from "../validation.js";
import { resolveActor, type RouteDeps } from "./deps.js";

export interface DeepDiveJobRow {
  id: string;
  list_entry_id: string;
  state: string;
  progress_fetched_pages: number;
  progress_planned_pages: number | null;
  partial_failures: unknown;
  error: unknown;
  attempts: number;
  created_at: Date | string;
  updated_at: Date | string;
}

export const DEEP_DIVE_JOB_SELECT = `
  select id, list_entry_id, state, progress_fetched_pages, progress_planned_pages,
         partial_failures, error, attempts, created_at, updated_at
    from deep_dive_jobs`;

export function toDeepDiveJob(row: DeepDiveJobRow): DeepDiveJob {
  return parseDbContract(
    deepDiveJobSchema,
    {
      id: row.id,
      listEntryId: row.list_entry_id,
      state: row.state,
      progress: {
        fetchedPages: row.progress_fetched_pages,
        plannedPages: row.progress_planned_pages,
      },
      partialFailures: row.partial_failures,
      error: row.error,
      attempts: row.attempts,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    },
    "deep_dive_jobs 行",
  );
}

/** pg-boss の多重投入防止キー（1 エントリあたり同時実行 1 — 4.1） */
export function deepDiveSingletonKey(entryId: string): string {
  return `deep_dive:${entryId}`;
}

export function registerDeepDiveJobRoutes(v1: Hono<AppEnv>, deps: RouteDeps): void {
  registerRoute(v1, "POST", "/deep-dive-jobs", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const body = await parseJsonBody(c, createDeepDiveJobsRequestSchema);
    const entryIds = [...new Set(body.entryIds)];

    const jobs = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);

      // 対象エントリの存在確認（他テナントは RLS で不可視 → 404 正規化）
      const entries = await tx.query<{ id: string }>(
        `select id from list_entries where id = any($1::uuid[])`,
        [entryIds],
      );
      if (entries.rows.length !== entryIds.length) {
        throw new ApiHttpError("RESOURCE_NOT_FOUND", "エントリが見つかりません");
      }

      // 実行中ジョブの多重投入チェック（E9: 1 エントリあたり同時実行 1）
      const running = await tx.query<{ list_entry_id: string }>(
        `select list_entry_id from deep_dive_jobs
          where list_entry_id = any($1::uuid[])
            and state in ('queued', 'collecting', 'analyzing')`,
        [entryIds],
      );
      if (running.rows.length > 0) {
        throw new ApiHttpError("JOB_ALREADY_RUNNING", "実行中の深掘りジョブがあります", {
          entryIds: running.rows.map((row) => row.list_entry_id),
        });
      }

      const created: DeepDiveJob[] = [];
      for (const entryId of entryIds) {
        const inserted = await tx.query<DeepDiveJobRow>(
          `insert into deep_dive_jobs (tenant_id, list_entry_id)
           values ($1, $2)
           returning id, list_entry_id, state, progress_fetched_pages, progress_planned_pages,
                     partial_failures, error, attempts, created_at, updated_at`,
          [auth.tenantId, entryId],
        );
        const row = inserted.rows[0];
        if (row === undefined) throw new Error("deep_dive_jobs の INSERT が行を返しません");
        await tx.query(
          `update list_entries set latest_deep_dive_job_id = $2, updated_at = now() where id = $1`,
          [entryId, row.id],
        );
        await recordAuditEvent(tx, {
          tenantId: auth.tenantId,
          actorUserId: actor.userId,
          eventType: "deep_dive.started",
          resourceType: "DeepDiveJob",
          resourceId: row.id,
          metadata: { listEntryId: entryId },
          requestId,
        });
        // キュー投入もトランザクション内で行う: enqueue 失敗時は行ごとロールバックされる。
        // コミット失敗で pg-boss ジョブだけ残った場合はワーカー側が行なしを検知して no-op
        try {
          await deps.queue.enqueue(
            "deep_dive",
            { deepDiveJobId: row.id, tenantId: auth.tenantId },
            { singletonKey: deepDiveSingletonKey(entryId), groupKey: auth.tenantId },
          );
        } catch (error) {
          if (error instanceof JobNotEnqueuedError) {
            throw new ApiHttpError("JOB_ALREADY_RUNNING", "実行中の深掘りジョブがあります", {
              entryIds: [entryId],
            });
          }
          throw error;
        }
        created.push(toDeepDiveJob(row));
      }
      return created;
    });

    return c.json({ jobs }, 202);
  });

  registerRoute(v1, "GET", "/deep-dive-jobs/:jobId", async (c) => {
    const auth = c.get("auth");
    const jobId = parseUuidParam(c, "jobId");
    const row = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const result = await tx.query<DeepDiveJobRow>(`${DEEP_DIVE_JOB_SELECT} where id = $1`, [
        jobId,
      ]);
      return result.rows[0];
    });
    if (row === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "ジョブが見つかりません");
    }
    return c.json(toDeepDiveJob(row));
  });

  registerRoute(v1, "POST", "/deep-dive-jobs/:jobId/retry", async (c) => {
    const auth = c.get("auth");
    const requestId = c.get("requestId");
    const jobId = parseUuidParam(c, "jobId");

    const row = await deps.tenantDb.withTenantContext(auth.tenantId, async (tx) => {
      const actor = await resolveActor(tx, auth);
      const current = await tx.query<DeepDiveJobRow>(`${DEEP_DIVE_JOB_SELECT} where id = $1`, [
        jobId,
      ]);
      const job = current.rows[0];
      if (job === undefined) return undefined;
      if (job.state !== "failed") {
        // failed → queued のみ許可（design-detail 4.1）
        throw new ApiHttpError("RESOURCE_CONFLICT", "failed 状態のジョブのみ再実行できます", {
          state: job.state,
        });
      }
      const updated = await tx.query<DeepDiveJobRow>(
        `update deep_dive_jobs
            set state = 'queued', error = null, attempts = 0,
                progress_fetched_pages = 0, progress_planned_pages = null,
                partial_failures = '[]'::jsonb, updated_at = now()
          where id = $1
          returning id, list_entry_id, state, progress_fetched_pages, progress_planned_pages,
                    partial_failures, error, attempts, created_at, updated_at`,
        [jobId],
      );
      const next = updated.rows[0];
      if (next === undefined) throw new Error("deep_dive_jobs の UPDATE が行を返しません");
      await recordAuditEvent(tx, {
        tenantId: auth.tenantId,
        actorUserId: actor.userId,
        eventType: "deep_dive.retried",
        resourceType: "DeepDiveJob",
        resourceId: jobId,
        metadata: { listEntryId: next.list_entry_id },
        requestId,
      });
      try {
        await deps.queue.enqueue(
          "deep_dive",
          { deepDiveJobId: jobId, tenantId: auth.tenantId },
          { singletonKey: deepDiveSingletonKey(next.list_entry_id), groupKey: auth.tenantId },
        );
      } catch (error) {
        if (error instanceof JobNotEnqueuedError) {
          throw new ApiHttpError("JOB_ALREADY_RUNNING", "実行中の深掘りジョブがあります");
        }
        throw error;
      }
      return next;
    });
    if (row === undefined) {
      throw new ApiHttpError("RESOURCE_NOT_FOUND", "ジョブが見つかりません");
    }
    return c.json(toDeepDiveJob(row), 202);
  });
}
