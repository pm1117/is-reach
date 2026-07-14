// 深掘りジョブのワーカー実装（design-detail 4.1 の状態機械 — 決定 E9）。
//
// queued → collecting（crawler.deepDive — 進捗を progress へ反映・部分失敗を記録）
//        → analyzing（analysis.prepareDossierSources → prompt.analyzeDossier）
//        → done（dossiers 保存）/ failed
//
// - 部分失敗許容: 1 ページ以上取得できれば analyzing へ。0 ページは CRAWL_ALL_FAILED。
// - フェーズタイムアウト: collecting 10 分 / analyzing 3 分（提案値 — 4.1）。
//   タイムアウトの error.code は 4.1 に明記がないため実装判断:
//   collecting = CRAWL_ALL_FAILED / analyzing = LLM_UNAVAILABLE（要レビュー）。
// - ジョブレベル自動リトライ: pg-boss retryLimit 2（30 秒 → 2 分 — キュー既定値）。
//   最終試行前の失敗は state を queued に戻して throw（pg-boss が再実行）。
//   最終試行 or permanent な失敗で failed を確定し、例外は握って正常終了する
//   （業務状態の正は deep_dive_jobs — pg-boss 側は実行制御のみ）。
// - テナント文脈の DB アクセスはすべて withTenantContext（RLS 経路 — basic-design 7.2-4）。
import {
  analyzeDossier as analyzeDossierReal,
  type DossierAnalysisInput,
  type DossierAnalysisResult,
  type PromptRuntime,
} from "@is-reach/prompt";
import { prepareDossierSources } from "@is-reach/analysis";
import type { Crawler } from "@is-reach/crawler";
import type { QueueJob } from "@is-reach/shared";
import type { TenantDb } from "../db/tenant-db.js";
import type { Logger } from "../types.js";
import { JobFailure, toJobFailure, withTimeout } from "./util.js";

/** 初回 + pg-boss retryLimit 2（E9） */
export const MAX_DEEP_DIVE_ATTEMPTS = 3;

export interface DeepDiveWorkerDeps {
  tenantDb: TenantDb;
  /** 1 ジョブ = 1 クローラーインスタンス（robots キャッシュ・レート制限の共有単位） */
  createCrawler: () => Crawler;
  promptRuntime: PromptRuntime;
  logger: Logger;
  /** テスト注入用（既定: prompt の実装） */
  analyzeDossier?: (
    input: DossierAnalysisInput,
    runtime: PromptRuntime,
  ) => Promise<DossierAnalysisResult>;
  timeouts?: {
    collectingMs?: number;
    analyzingMs?: number;
  };
}

interface JobContext {
  attempts: number;
  listEntryId: string;
  companyName: string;
  companyDomain: string | null;
  companyIndustry: string | null;
  companyEmployeeRange: string | null;
  serviceSummary: string;
}

export function createDeepDiveHandler(
  deps: DeepDiveWorkerDeps,
): (job: QueueJob<"deep_dive">) => Promise<void> {
  const collectingMs = deps.timeouts?.collectingMs ?? 10 * 60_000;
  const analyzingMs = deps.timeouts?.analyzingMs ?? 3 * 60_000;
  const analyzeDossier = deps.analyzeDossier ?? analyzeDossierReal;

  return async (job) => {
    const { deepDiveJobId, tenantId } = job.payload;

    // 1. ジョブ行のロード + collecting 着手（attempts をこの試行分カウント）
    const context = await deps.tenantDb.withTenantContext(
      tenantId,
      async (tx): Promise<JobContext | null> => {
        const result = await tx.query<{
          state: string;
          attempts: number;
          list_entry_id: string;
          company_name: string;
          company_domain: string | null;
          company_industry: string | null;
          company_employee_range: string | null;
          service_summary: string;
        }>(
          `select j.state, j.attempts, j.list_entry_id,
                  c.name as company_name, c.domain as company_domain,
                  c.industry as company_industry, c.employee_range as company_employee_range,
                  t.service_summary
             from deep_dive_jobs j
             join list_entries e on e.id = j.list_entry_id
             join companies c on c.id = e.company_id
             join tenants t on t.id = j.tenant_id
            where j.id = $1`,
          [deepDiveJobId],
        );
        const row = result.rows[0];
        // 行なし（コミット失敗のゴーストジョブ・E4 削除済み）/ 終端状態は no-op（冪等）
        if (row === undefined || row.state === "done" || row.state === "failed") return null;
        await tx.query(
          `update deep_dive_jobs
              set state = 'collecting', attempts = attempts + 1, error = null, updated_at = now()
            where id = $1`,
          [deepDiveJobId],
        );
        return {
          attempts: row.attempts + 1,
          listEntryId: row.list_entry_id,
          companyName: row.company_name,
          companyDomain: row.company_domain,
          companyIndustry: row.company_industry,
          companyEmployeeRange: row.company_employee_range,
          serviceSummary: row.service_summary,
        };
      },
    );
    if (context === null) {
      deps.logger.info("deep_dive: 対象ジョブなしのためスキップ", { deepDiveJobId });
      return;
    }

    try {
      // 2. collecting（E12 の節度は crawler 内で強制）
      if (context.companyDomain === null || context.companyDomain === "") {
        throw new JobFailure("CRAWL_ALL_FAILED", "企業ドメイン未設定のため収集できません", {
          permanent: true,
        });
      }
      const crawler = deps.createCrawler();
      // 進捗はポーリング表示用（3 秒間隔 — E13）。失敗しても収集は継続する
      const onProgress = (progress: {
        fetchedPages: number;
        plannedPages: number | null;
      }): void => {
        void deps.tenantDb
          .withTenantContext(tenantId, (tx) =>
            tx.query(
              `update deep_dive_jobs
                  set progress_fetched_pages = $2, progress_planned_pages = $3, updated_at = now()
                where id = $1 and state = 'collecting'`,
              [deepDiveJobId, progress.fetchedPages, progress.plannedPages],
            ),
          )
          .catch((error: unknown) => {
            deps.logger.error("deep_dive: 進捗更新に失敗", {
              deepDiveJobId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      };
      const crawlResult = await withTimeout(
        crawler.deepDive({ startUrl: context.companyDomain, onProgress }),
        collectingMs,
        () => new JobFailure("CRAWL_ALL_FAILED", "collecting フェーズがタイムアウトしました"),
      );

      if (crawlResult.pages.length === 0) {
        // 全ページ取得失敗（4.1）。部分失敗一覧は failed 遷移側で記録する
        const failure = new JobFailure("CRAWL_ALL_FAILED", "1 ページも取得できませんでした");
        await recordPartialFailures(deps.tenantDb, tenantId, deepDiveJobId, crawlResult);
        throw failure;
      }

      // 3. 前処理（重複除去・kind 分類・優先度順 — analysis）と収集データの永続化
      const sources = prepareDossierSources(
        crawlResult.pages.map((page) => ({
          url: page.url,
          fetchedAt: page.fetchedAt,
          title: page.title,
          text: page.text,
        })),
      );
      await deps.tenantDb.withTenantContext(tenantId, async (tx) => {
        await tx.query(
          `update deep_dive_jobs
              set state = 'analyzing',
                  progress_fetched_pages = $2,
                  partial_failures = $3,
                  updated_at = now()
            where id = $1`,
          [deepDiveJobId, crawlResult.pages.length, JSON.stringify(crawlResult.partialFailures)],
        );
        // 再実行時の重複を防ぐため、当該エントリの収集データを入れ替える
        await tx.query(`delete from collected_documents where list_entry_id = $1`, [
          context.listEntryId,
        ]);
        for (const source of sources) {
          await tx.query(
            `insert into collected_documents
               (tenant_id, list_entry_id, source_url, fetched_at, kind, title, body)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              tenantId,
              context.listEntryId,
              source.url,
              source.fetchedAt,
              source.kind,
              source.title?.text ?? null,
              source.text.text,
            ],
          );
        }
      });

      // 4. analyzing（LLM は prompt 経由のみ — basic-design 2.1。E6/E7/E8 は prompt 内で強制）
      const analysis = await withTimeout(
        analyzeDossier(
          {
            company: {
              name: context.companyName,
              domain: context.companyDomain,
              industry: context.companyIndustry,
              employeeRange: context.companyEmployeeRange,
            },
            // 未設定でも接続点分析以外は成立するため、明示のプレースホルダで継続する（実装判断）
            tenantServiceSummary:
              context.serviceSummary === ""
                ? "（自社サービス概要は未設定）"
                : context.serviceSummary,
            sources: sources.map((source) => ({ kind: source.kind, content: source.text })),
          },
          deps.promptRuntime,
        ),
        analyzingMs,
        () => new JobFailure("LLM_UNAVAILABLE", "analyzing フェーズがタイムアウトしました"),
      );

      // 5. done: ドシエ保存（エントリ 1:1 — 再実行は上書き）+ ジョブ完了
      await deps.tenantDb.withTenantContext(tenantId, async (tx) => {
        const dossierSources = analysis.sources.map((usage) => {
          const source = sources.find((candidate) => candidate.url === usage.url);
          return {
            url: usage.url,
            fetchedAt: usage.fetchedAt,
            title: source?.title?.text ?? null,
          };
        });
        await tx.query(
          `insert into dossiers
             (tenant_id, list_entry_id, business_summary, inferred_issues, service_hooks,
              sources, warnings, model_id, generated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, now())
           on conflict (list_entry_id) do update set
             business_summary = excluded.business_summary,
             inferred_issues = excluded.inferred_issues,
             service_hooks = excluded.service_hooks,
             sources = excluded.sources,
             warnings = excluded.warnings,
             model_id = excluded.model_id,
             generated_at = now()`,
          [
            tenantId,
            context.listEntryId,
            JSON.stringify(analysis.businessSummary),
            JSON.stringify(analysis.inferredIssues),
            JSON.stringify(analysis.serviceHooks),
            JSON.stringify(dossierSources),
            JSON.stringify(analysis.warnings),
            analysis.modelId,
          ],
        );
        await tx.query(
          `update deep_dive_jobs set state = 'done', error = null, updated_at = now()
            where id = $1`,
          [deepDiveJobId],
        );
      });
    } catch (error) {
      const failure = toJobFailure(error);
      const isFinal = failure.permanent || context.attempts >= MAX_DEEP_DIVE_ATTEMPTS;
      await deps.tenantDb.withTenantContext(tenantId, async (tx) => {
        if (isFinal) {
          await tx.query(
            `update deep_dive_jobs
                set state = 'failed', error = $2, updated_at = now()
              where id = $1`,
            [deepDiveJobId, JSON.stringify({ code: failure.code, message: failure.message })],
          );
        } else {
          // 自動リトライ待ち: 業務状態は queued に戻す（failed は最終確定のみ — 4.1）
          await tx.query(
            `update deep_dive_jobs set state = 'queued', updated_at = now() where id = $1`,
            [deepDiveJobId],
          );
        }
      });
      if (isFinal) {
        deps.logger.error("deep_dive: ジョブ失敗を確定", {
          deepDiveJobId,
          code: failure.code,
          attempts: context.attempts,
        });
        return; // 業務状態は確定済み。pg-boss へは正常終了として返す
      }
      throw failure; // pg-boss のジョブレベルリトライへ
    }
  };
}

async function recordPartialFailures(
  tenantDb: TenantDb,
  tenantId: string,
  deepDiveJobId: string,
  crawlResult: { partialFailures: readonly { url: string; reason: string }[] },
): Promise<void> {
  await tenantDb.withTenantContext(tenantId, (tx) =>
    tx.query(`update deep_dive_jobs set partial_failures = $2, updated_at = now() where id = $1`, [
      deepDiveJobId,
      JSON.stringify(crawlResult.partialFailures),
    ]),
  );
}
