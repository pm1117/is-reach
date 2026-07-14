// メッセージ生成ジョブのワーカー実装（決定 E13 — 非同期ジョブ + ポーリング）。
//
// queued → generating（prompt.generateMessageParts — 骨子は Template から機械埋め込み）
//        → done（messages 保存 + message.generated 監査ログ）/ failed
//
// - LLM は prompt 経由のみ（E6/E7/E8/E11 は prompt 内で強制）。
// - ドシエ各セクションは「一度外部由来になったものは以後も信頼境界外」（basic-design 6.1）
//   のため UntrustedText として渡す。sourceUrl はセクションの根拠 URL
//   （なければドシエ収集ソースの先頭）を用いる。
// - 監査ログ message.generated は警告有無を metadata に記録（7.1）。actor は
//   ジョブ起動ユーザー（message_jobs.created_by — 7.2 の引き継ぎ）。
import {
  generateMessageParts as generateMessagePartsReal,
  type MessageGenerationInput,
  type MessageGenerationResult,
  type PromptRuntime,
} from "@is-reach/prompt";
import {
  dossierSchema,
  markUntrusted,
  templateSchema,
  type QueueJob,
  type UntrustedText,
} from "@is-reach/shared";
import { recordAuditEvent } from "../audit/audit-log.js";
import type { TenantDb } from "../db/tenant-db.js";
import type { Logger } from "../types.js";
import { toIso, parseDbContract } from "../validation.js";
import { JobFailure, toJobFailure } from "./util.js";

/** 初回 + pg-boss retryLimit 1（キュー既定値 — 実装判断） */
export const MAX_GENERATE_MESSAGE_ATTEMPTS = 2;

export interface GenerateMessageWorkerDeps {
  tenantDb: TenantDb;
  promptRuntime: PromptRuntime;
  logger: Logger;
  /** テスト注入用（既定: prompt の実装） */
  generateMessageParts?: (
    input: MessageGenerationInput,
    runtime: PromptRuntime,
  ) => Promise<MessageGenerationResult>;
}

interface JobContext {
  attempts: number;
  listEntryId: string;
  templateId: string | null;
  createdBy: string | null;
  serviceSummary: string;
}

/** ドシエ各セクションを UntrustedText 化する（根拠 URL がないセクションはソース先頭にフォールバック） */
export function dossierSectionsToUntrusted(dossier: {
  businessSummary: { body: string; evidence: { kind: string; urls?: string[] } };
  inferredIssues: { body: string; evidence: { kind: string; urls?: string[] } }[];
  serviceHooks: { body: string; evidence: { kind: string; urls?: string[] } }[];
  sources: { url: string }[];
  generatedAt: string;
}): { content: UntrustedText }[] {
  const fallbackUrl = dossier.sources[0]?.url;
  const sections = [dossier.businessSummary, ...dossier.inferredIssues, ...dossier.serviceHooks];
  const result: { content: UntrustedText }[] = [];
  for (const section of sections) {
    if (section.body === "") continue;
    const sourceUrl =
      (section.evidence.kind === "sources" ? section.evidence.urls?.[0] : undefined) ?? fallbackUrl;
    if (sourceUrl === undefined) continue; // 出典を特定できないセクションは渡さない（8.2）
    result.push({
      content: markUntrusted({
        text: section.body,
        sourceUrl,
        collectedAt: dossier.generatedAt,
      }),
    });
  }
  return result;
}

export function createGenerateMessageHandler(
  deps: GenerateMessageWorkerDeps,
): (job: QueueJob<"generate_message">) => Promise<void> {
  const generateMessageParts = deps.generateMessageParts ?? generateMessagePartsReal;

  return async (job) => {
    const { messageJobId, tenantId } = job.payload;

    // 1. ジョブ行 + 関連（テンプレート・ドシエ・自社サービス概要）のロード + generating 着手
    const loaded = await deps.tenantDb.withTenantContext(tenantId, async (tx) => {
      const result = await tx.query<{
        state: string;
        attempts: number;
        list_entry_id: string;
        template_id: string | null;
        created_by: string | null;
        service_summary: string;
      }>(
        `select j.state, j.attempts, j.list_entry_id, j.template_id, j.created_by,
                t.service_summary
           from message_jobs j
           join tenants t on t.id = j.tenant_id
          where j.id = $1`,
        [messageJobId],
      );
      const row = result.rows[0];
      if (row === undefined || row.state === "done" || row.state === "failed") return null;
      await tx.query(
        `update message_jobs
            set state = 'generating', attempts = attempts + 1, error = null, updated_at = now()
          where id = $1`,
        [messageJobId],
      );
      return {
        attempts: row.attempts + 1,
        listEntryId: row.list_entry_id,
        templateId: row.template_id,
        createdBy: row.created_by,
        serviceSummary: row.service_summary,
      } satisfies JobContext;
    });
    if (loaded === null) {
      deps.logger.info("generate_message: 対象ジョブなしのためスキップ", { messageJobId });
      return;
    }

    try {
      // 2. テンプレート・ドシエのロード（投入後の削除レースは permanent 失敗）
      const inputs = await deps.tenantDb.withTenantContext(tenantId, async (tx) => {
        if (loaded.templateId === null) {
          throw new JobFailure("RESOURCE_NOT_FOUND", "テンプレートが削除されています", {
            permanent: true,
          });
        }
        const templateResult = await tx.query<{
          id: string;
          name: string;
          introduction: string;
          cta: string;
          tone: string;
          max_length: number;
          created_by: string | null;
          updated_at: Date | string;
        }>(
          `select id, name, introduction, cta, tone, max_length, created_by, updated_at
             from templates where id = $1`,
          [loaded.templateId],
        );
        const templateRow = templateResult.rows[0];
        if (templateRow === undefined) {
          throw new JobFailure("RESOURCE_NOT_FOUND", "テンプレートが削除されています", {
            permanent: true,
          });
        }
        const dossierResult = await tx.query<{
          id: string;
          business_summary: unknown;
          inferred_issues: unknown;
          service_hooks: unknown;
          sources: unknown;
          warnings: unknown;
          model_id: string;
          list_entry_id: string;
          generated_at: Date | string;
        }>(
          `select id, list_entry_id, business_summary, inferred_issues, service_hooks,
                  sources, warnings, model_id, generated_at
             from dossiers where list_entry_id = $1`,
          [loaded.listEntryId],
        );
        const dossierRow = dossierResult.rows[0];
        if (dossierRow === undefined) {
          throw new JobFailure("RESOURCE_NOT_FOUND", "ドシエが削除されています", {
            permanent: true,
          });
        }
        const template = parseDbContract(
          templateSchema,
          {
            id: templateRow.id,
            name: templateRow.name,
            introduction: templateRow.introduction,
            cta: templateRow.cta,
            tone: templateRow.tone,
            maxLength: templateRow.max_length,
            createdBy: templateRow.created_by,
            updatedAt: toIso(templateRow.updated_at),
          },
          "templates 行",
        );
        const dossier = parseDbContract(
          dossierSchema,
          {
            id: dossierRow.id,
            listEntryId: dossierRow.list_entry_id,
            businessSummary: dossierRow.business_summary,
            inferredIssues: dossierRow.inferred_issues,
            serviceHooks: dossierRow.service_hooks,
            sources: dossierRow.sources,
            warnings: dossierRow.warnings,
            modelId: dossierRow.model_id,
            generatedAt: toIso(dossierRow.generated_at),
          },
          "dossiers 行",
        );
        return { template, dossier };
      });

      // 3. 生成（タイムアウト・リトライは prompt の設定 — E11 — に委ねる）
      const generated = await generateMessageParts(
        {
          template: inputs.template,
          tenantServiceSummary:
            loaded.serviceSummary === "" ? "（自社サービス概要は未設定）" : loaded.serviceSummary,
          dossierSections: dossierSectionsToUntrusted(inputs.dossier),
        },
        deps.promptRuntime,
      );

      // 4. done: messages 保存 + ジョブ完了 + 監査ログ（同一トランザクションで原子的に）
      await deps.tenantDb.withTenantContext(tenantId, async (tx) => {
        const inserted = await tx.query<{ id: string }>(
          `insert into messages
             (tenant_id, list_entry_id, template_id, dossier_id, parts, assembled_body,
              validation, model_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
          [
            tenantId,
            loaded.listEntryId,
            loaded.templateId,
            inputs.dossier.id,
            JSON.stringify(generated.parts),
            generated.assembledBody,
            JSON.stringify(generated.validation),
            generated.modelId,
          ],
        );
        const messageId = inserted.rows[0]?.id;
        if (messageId === undefined) throw new Error("messages の INSERT が行を返しません");
        await tx.query(
          `update message_jobs
              set state = 'done', message_id = $2, error = null, updated_at = now()
            where id = $1`,
          [messageJobId, messageId],
        );
        await recordAuditEvent(tx, {
          tenantId,
          actorUserId: loaded.createdBy,
          eventType: "message.generated",
          resourceType: "Message",
          resourceId: messageId,
          metadata: {
            warned: generated.validation.warnings.length > 0,
            warningCodes: generated.validation.warnings.map((warning) => warning.code),
            messageJobId,
          },
        });
      });
    } catch (error) {
      const failure = toJobFailure(error);
      const isFinal = failure.permanent || loaded.attempts >= MAX_GENERATE_MESSAGE_ATTEMPTS;
      await deps.tenantDb.withTenantContext(tenantId, async (tx) => {
        if (isFinal) {
          await tx.query(
            `update message_jobs set state = 'failed', error = $2, updated_at = now()
              where id = $1`,
            [messageJobId, JSON.stringify({ code: failure.code, message: failure.message })],
          );
        } else {
          await tx.query(
            `update message_jobs set state = 'queued', updated_at = now() where id = $1`,
            [messageJobId],
          );
        }
      });
      if (isFinal) {
        deps.logger.error("generate_message: ジョブ失敗を確定", {
          messageJobId,
          code: failure.code,
          attempts: loaded.attempts,
        });
        return;
      }
      throw failure;
    }
  };
}
