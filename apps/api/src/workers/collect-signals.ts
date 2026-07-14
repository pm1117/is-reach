// シグナル収集バッチ（basic-design パイプライン ① — 頻度は仮置き: 日次深夜帯）。
//
// - シードリスト（収集対象ソース）は環境設定値（config.ts signalSeedSchema）。
//   具体リストは仮置きで、運用前に人間確認する（pr-plan 4.3）。空なら何もしない。
// - 書き込みは app_batch 接続（BatchDb — 共有資産 companies / signals の唯一の書き込み経路。
//   design-detail 6.1）。テナント資産には触れない。
// - ソース単位の失敗はスキップして継続し、失敗率が 50% を超えたらバッチ全体を
//   異常終了（throw → pg-boss failed）として運用アラート対象にする（design-detail 4.2）。
// - シグナルの summary はページタイトル（なければ本文先頭）から機械的に切り出す
//   【実装判断 — シード確定時に抽出ロジックを見直す】。summary は信頼境界外データとして
//   扱われる（表示は SafeText・プロンプト投入時は S1〜S5 — 既存設計どおり）。
import type { Crawler, FetchedPage } from "@is-reach/crawler";
import type { QueueJob } from "@is-reach/shared";
import type { SignalSeed } from "../config.js";
import type { BatchDb } from "../db/tenant-db.js";
import type { Logger } from "../types.js";

export interface CollectSignalsWorkerDeps {
  batchDb: BatchDb;
  createCrawler: () => Crawler;
  seeds: readonly SignalSeed[];
  logger: Logger;
  /** ソース失敗率の異常終了しきい値（既定 0.5 — design-detail 4.2） */
  failureRateThreshold?: number;
}

/** summary の最大文字数（一覧表示・キーワード照合用の短い要約 — 実装判断） */
export const SIGNAL_SUMMARY_MAX_CHARS = 300;

function summarize(page: FetchedPage): string {
  const raw = page.title?.text ?? page.text.text;
  return raw.replace(/\s+/g, " ").trim().slice(0, SIGNAL_SUMMARY_MAX_CHARS);
}

function normalizeUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

async function upsertCompany(batchDb: BatchDb, seed: SignalSeed): Promise<string> {
  const domain = seed.companyDomain ?? new URL(seed.url).hostname;
  const existing = await batchDb.query<{ id: string }>(
    `select id from companies where domain = $1 limit 1`,
    [domain],
  );
  const found = existing.rows[0];
  if (found !== undefined) return found.id;
  const inserted = await batchDb.query<{ id: string }>(
    `insert into companies (name, domain) values ($1, $2) returning id`,
    [seed.companyName ?? domain, domain],
  );
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error("companies の INSERT が行を返しません");
  return id;
}

async function upsertSignal(
  batchDb: BatchDb,
  companyId: string,
  seed: SignalSeed,
  page: FetchedPage,
): Promise<void> {
  const summary = summarize(page);
  // source_url 単位で 1 シグナル（同一ページの再収集は更新 — バッチは日次直列のため
  // SELECT → INSERT/UPDATE で十分。実装判断）
  const existing = await batchDb.query<{ id: string }>(
    `select id from signals where company_id = $1 and source_url = $2 limit 1`,
    [companyId, page.url],
  );
  const found = existing.rows[0];
  if (found !== undefined) {
    await batchDb.query(`update signals set summary = $2, collected_at = $3 where id = $1`, [
      found.id,
      summary,
      page.fetchedAt,
    ]);
    return;
  }
  await batchDb.query(
    `insert into signals (company_id, kind, summary, attributes, source_url, collected_at)
     values ($1, $2, $3, '{}'::jsonb, $4, $5)`,
    [companyId, seed.kind, summary, page.url, page.fetchedAt],
  );
}

export function createCollectSignalsHandler(
  deps: CollectSignalsWorkerDeps,
): (job: QueueJob<"collect_signals">) => Promise<void> {
  const threshold = deps.failureRateThreshold ?? 0.5;

  return async () => {
    if (deps.seeds.length === 0) {
      deps.logger.info("collect_signals: シード未設定のためスキップ（仮置き — 運用前に人間確認）");
      return;
    }

    const crawler = deps.createCrawler();
    const result = await crawler.collectSignals({
      sourceUrls: deps.seeds.map((seed) => seed.url),
    });
    const bySourceUrl = new Map(
      result.sources.map((source) => [normalizeUrl(source.sourceUrl), source]),
    );

    let failedSources = 0;
    for (const seed of deps.seeds) {
      const source = bySourceUrl.get(normalizeUrl(seed.url));
      if (source === undefined || source.pages.length === 0) {
        failedSources += 1;
        deps.logger.error("collect_signals: ソース収集に失敗", {
          sourceUrl: seed.url,
          partialFailures: source?.partialFailures ?? [],
        });
        continue;
      }
      try {
        const companyId = await upsertCompany(deps.batchDb, seed);
        for (const page of source.pages) {
          await upsertSignal(deps.batchDb, companyId, seed, page);
        }
      } catch (error) {
        failedSources += 1;
        deps.logger.error("collect_signals: ソースの永続化に失敗", {
          sourceUrl: seed.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const failureRate = failedSources / deps.seeds.length;
    if (failureRate > threshold) {
      // バッチ異常終了（pg-boss failed → 運用アラート対象 — design-detail 4.2）
      throw new Error(
        `シグナル収集の失敗率が閾値を超えました（${failedSources}/${deps.seeds.length}）`,
      );
    }
  };
}
