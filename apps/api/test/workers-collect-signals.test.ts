// シグナル収集バッチのテスト。crawler / BatchDb は注入モック。
// シード空 → no-op・upsert 動作・失敗率 50% 超の異常終了を検証する。
import { markUntrusted } from "@is-reach/shared";
import type { CollectSignalsResult, Crawler } from "@is-reach/crawler";
import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import type { BatchDb } from "../src/db/tenant-db.js";
import { createCollectSignalsHandler } from "../src/workers/collect-signals.js";
import { RecordingLogger } from "./helpers.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const AT = "2026-07-14T00:00:00.000Z";

class FakeBatchDb implements BatchDb {
  readonly queries: { text: string; values: readonly unknown[] | undefined }[] = [];
  readonly #responders: { pattern: RegExp; rows: QueryResultRow[] }[] = [];
  ended = false;

  respond(pattern: RegExp, rows: QueryResultRow[]): this {
    this.#responders.push({ pattern, rows });
    return this;
  }

  findQuery(pattern: RegExp) {
    return this.queries.find((query) => pattern.test(query.text));
  }

  findQueries(pattern: RegExp) {
    return this.queries.filter((query) => pattern.test(query.text));
  }

  async query<R extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>> {
    this.queries.push({ text, values });
    const responder = this.#responders.find((entry) => entry.pattern.test(text));
    const rows = responder?.rows ?? [];
    return {
      rows: rows as R[],
      rowCount: rows.length,
      command: "",
      oid: 0,
      fields: [],
    } as unknown as QueryResult<R>;
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

function page(url: string) {
  return {
    requestedUrl: url,
    url,
    fetchedAt: AT,
    title: markUntrusted({ text: "採用情報", sourceUrl: url, collectedAt: AT }),
    text: markUntrusted({ text: "React エンジニア募集の本文", sourceUrl: url, collectedAt: AT }),
  };
}

function fakeCrawler(result: CollectSignalsResult): { crawler: Crawler; calls: number[] } {
  const calls: number[] = [];
  return {
    crawler: {
      deepDive: () => Promise.reject(new Error("deepDive は使わない")),
      collectSignals: async (input) => {
        calls.push(input.sourceUrls.length);
        return result;
      },
    },
    calls,
  };
}

const SEED = {
  url: "https://example.co.jp/careers",
  kind: "job_posting" as const,
  companyName: "テスト株式会社",
};

function job() {
  return { id: "pgboss-3", name: "collect_signals" as const, payload: {} };
}

describe("collect_signals バッチ", () => {
  it("シード未設定なら何もしない（クローラを呼ばない）", async () => {
    const batchDb = new FakeBatchDb();
    const { crawler, calls } = fakeCrawler({ sources: [], abortedHosts: [] });
    const logger = new RecordingLogger();
    const handler = createCollectSignalsHandler({
      batchDb,
      createCrawler: () => crawler,
      seeds: [],
      logger,
    });
    await handler(job());
    expect(calls).toHaveLength(0);
    expect(batchDb.queries).toHaveLength(0);
    expect(logger.infos.some((entry) => entry.message.includes("シード未設定"))).toBe(true);
  });

  it("新規企業 + 新規シグナルを upsert する（companies / signals は app_batch 経路）", async () => {
    const batchDb = new FakeBatchDb();
    batchDb.respond(/select id from companies where domain/, []); // 未登録
    batchDb.respond(/insert into companies/, [{ id: COMPANY_ID }]);
    batchDb.respond(/select id from signals/, []);
    const { crawler } = fakeCrawler({
      sources: [
        {
          sourceUrl: "https://example.co.jp/careers",
          pages: [page("https://example.co.jp/careers/1")],
          partialFailures: [],
        },
      ],
      abortedHosts: [],
    });
    const handler = createCollectSignalsHandler({
      batchDb,
      createCrawler: () => crawler,
      seeds: [SEED],
      logger: new RecordingLogger(),
    });
    await handler(job());

    const companyInsert = batchDb.findQuery(/insert into companies/);
    expect(companyInsert?.values).toEqual(["テスト株式会社", "example.co.jp"]);
    const signalInsert = batchDb.findQuery(/insert into signals/);
    expect(signalInsert?.values?.[0]).toBe(COMPANY_ID);
    expect(signalInsert?.values?.[1]).toBe("job_posting");
    expect(signalInsert?.values?.[2]).toBe("採用情報"); // タイトル由来の要約
    expect(signalInsert?.values?.[3]).toBe("https://example.co.jp/careers/1");
  });

  it("既存シグナル（同一 source_url）は INSERT ではなく UPDATE する", async () => {
    const batchDb = new FakeBatchDb();
    batchDb.respond(/select id from companies where domain/, [{ id: COMPANY_ID }]);
    batchDb.respond(/select id from signals/, [{ id: "22222222-2222-4222-8222-222222222222" }]);
    const { crawler } = fakeCrawler({
      sources: [
        {
          sourceUrl: "https://example.co.jp/careers",
          pages: [page("https://example.co.jp/careers/1")],
          partialFailures: [],
        },
      ],
      abortedHosts: [],
    });
    const handler = createCollectSignalsHandler({
      batchDb,
      createCrawler: () => crawler,
      seeds: [SEED],
      logger: new RecordingLogger(),
    });
    await handler(job());
    expect(batchDb.findQuery(/update signals set summary/)).toBeDefined();
    expect(batchDb.findQuery(/insert into signals/)).toBeUndefined();
  });

  it("失敗率が 50% を超えたらバッチ全体を異常終了する（4.2）", async () => {
    const batchDb = new FakeBatchDb();
    const { crawler } = fakeCrawler({ sources: [], abortedHosts: [] }); // 全ソース結果なし
    const handler = createCollectSignalsHandler({
      batchDb,
      createCrawler: () => crawler,
      seeds: [SEED, { ...SEED, url: "https://another.example/blog", kind: "tech_blog" }],
      logger: new RecordingLogger(),
    });
    await expect(handler(job())).rejects.toThrowError(/失敗率/);
  });

  it("失敗率がちょうど 50% なら継続する（> 閾値のみ異常終了）", async () => {
    const batchDb = new FakeBatchDb();
    batchDb.respond(/select id from companies where domain/, [{ id: COMPANY_ID }]);
    batchDb.respond(/select id from signals/, []);
    const { crawler } = fakeCrawler({
      sources: [
        {
          sourceUrl: "https://example.co.jp/careers",
          pages: [page("https://example.co.jp/careers/1")],
          partialFailures: [],
        },
        { sourceUrl: "https://another.example/blog", pages: [], partialFailures: [] },
      ],
      abortedHosts: [],
    });
    const logger = new RecordingLogger();
    const handler = createCollectSignalsHandler({
      batchDb,
      createCrawler: () => crawler,
      seeds: [SEED, { ...SEED, url: "https://another.example/blog", kind: "tech_blog" }],
      logger,
    });
    await handler(job()); // throw しない
    expect(logger.errors.some((entry) => entry.message.includes("ソース収集に失敗"))).toBe(true);
  });
});
