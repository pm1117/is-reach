// 深掘りワーカー（E9 / design-detail 4.1）の状態機械テスト。
// crawler / prompt は注入モック。DB は FakeTenantDb（RLS 経路の withTenantContext）で検証。
import { markUntrusted } from "@is-reach/shared";
import type { Crawler, DeepDiveFetchResult } from "@is-reach/crawler";
import type { DossierAnalysisInput, DossierAnalysisResult, PromptRuntime } from "@is-reach/prompt";
import { PromptError } from "@is-reach/prompt";
import { describe, expect, it } from "vitest";
import { createDeepDiveHandler, MAX_DEEP_DIVE_ATTEMPTS } from "../src/workers/deep-dive.js";
import { JobFailure } from "../src/workers/util.js";
import { FakeTenantDb, RecordingLogger, TEST_TENANT_ID } from "./helpers.js";

const JOB_ID = "55555555-5555-4555-8555-555555555555";
const ENTRY_ID = "44444444-4444-4444-8444-444444444444";
const AT = "2026-07-14T00:00:00.000Z";

const dummyRuntime: PromptRuntime = {
  client: {
    complete: () => Promise.reject(new Error("モック注入済みのため LLM クライアントは呼ばれない")),
  },
};

function contextRow(overrides: Record<string, unknown> = {}) {
  return {
    state: "queued",
    attempts: 0,
    list_entry_id: ENTRY_ID,
    company_name: "テスト株式会社",
    company_domain: "example.co.jp",
    company_industry: "software",
    company_employee_range: "51-100",
    service_summary: "リサーチ自動化 SaaS",
    ...overrides,
  };
}

function page(url: string, body: string) {
  return {
    requestedUrl: url,
    url,
    fetchedAt: AT,
    title: markUntrusted({ text: "タイトル", sourceUrl: url, collectedAt: AT }),
    text: markUntrusted({ text: body, sourceUrl: url, collectedAt: AT }),
  };
}

function fakeCrawler(result: DeepDiveFetchResult | (() => Promise<DeepDiveFetchResult>)): Crawler {
  return {
    deepDive: typeof result === "function" ? result : async () => result,
    collectSignals: () => Promise.reject(new Error("collectSignals は使わない")),
  };
}

function successAnalysis(): DossierAnalysisResult {
  return {
    businessSummary: {
      body: "事業サマリ",
      evidence: { kind: "sources", urls: ["https://example.co.jp/about"] },
    },
    inferredIssues: [],
    serviceHooks: [],
    sources: [
      {
        url: "https://example.co.jp/about",
        fetchedAt: AT,
        kind: "corporate_site",
        truncated: false,
        used: true,
        excludedReason: null,
      },
    ],
    warnings: [],
    modelId: "claude-sonnet-test",
  };
}

function jobPayload() {
  return {
    id: "pgboss-1",
    name: "deep_dive" as const,
    payload: { deepDiveJobId: JOB_ID, tenantId: TEST_TENANT_ID },
  };
}

describe("deep_dive ワーカーの状態機械（4.1）", () => {
  it("成功系: collecting → analyzing → done。部分失敗を許容し記録する", async () => {
    const tenantDb = new FakeTenantDb();
    tenantDb.respond(/from deep_dive_jobs j/, [contextRow()]);
    tenantDb.respond(/insert into dossiers/, []);
    const analyzed: DossierAnalysisInput[] = [];
    const handler = createDeepDiveHandler({
      tenantDb,
      createCrawler: () =>
        fakeCrawler({
          pages: [page("https://example.co.jp/about", "会社概要本文")],
          partialFailures: [{ url: "https://example.co.jp/broken", reason: "http_5xx" }],
          abortedHosts: [],
        }),
      promptRuntime: dummyRuntime,
      logger: new RecordingLogger(),
      analyzeDossier: async (input) => {
        analyzed.push(input);
        return successAnalysis();
      },
    });

    await handler(jobPayload());

    // 状態遷移の記録
    expect(tenantDb.findQuery(/set state = 'collecting'/)).toBeDefined();
    const analyzing = tenantDb.findQuery(/state = 'analyzing'/);
    expect(analyzing).toBeDefined();
    expect(String(analyzing?.values?.[2])).toContain("http_5xx"); // 部分失敗の記録
    expect(tenantDb.findQuery(/insert into collected_documents/)).toBeDefined();
    expect(tenantDb.findQuery(/insert into dossiers/)).toBeDefined();
    expect(tenantDb.findQuery(/set state = 'done'/)).toBeDefined();
    // analysis 入力: 信頼済み企業属性 + UntrustedText のソース
    expect(analyzed[0]?.company.name).toBe("テスト株式会社");
    expect(analyzed[0]?.sources[0]?.kind).toBe("corporate_site");
    expect(analyzed[0]?.tenantServiceSummary).toBe("リサーチ自動化 SaaS");
    // テナントコンテキストが全アクセスで復元されている（7.2-4）
    expect(new Set(tenantDb.contexts)).toEqual(new Set([TEST_TENANT_ID]));
  });

  it("全ページ取得失敗 → CRAWL_ALL_FAILED。初回試行は queued に戻して throw（自動リトライへ）", async () => {
    const tenantDb = new FakeTenantDb();
    tenantDb.respond(/from deep_dive_jobs j/, [contextRow()]);
    const handler = createDeepDiveHandler({
      tenantDb,
      createCrawler: () =>
        fakeCrawler({
          pages: [],
          partialFailures: [{ url: "https://example.co.jp/", reason: "connection_error" }],
          abortedHosts: [],
        }),
      promptRuntime: dummyRuntime,
      logger: new RecordingLogger(),
      analyzeDossier: () => Promise.reject(new Error("呼ばれない想定")),
    });

    await expect(handler(jobPayload())).rejects.toThrowError(JobFailure);
    expect(tenantDb.findQuery(/set state = 'queued'/)).toBeDefined();
    expect(tenantDb.findQuery(/set state = 'failed'/)).toBeUndefined();
    // 部分失敗は failed 前でも記録される
    expect(tenantDb.findQuery(/set partial_failures/)).toBeDefined();
  });

  it("最終試行（attempts = 上限）での失敗は failed を確定し、例外を握って正常終了する", async () => {
    const tenantDb = new FakeTenantDb();
    tenantDb.respond(/from deep_dive_jobs j/, [
      contextRow({ attempts: MAX_DEEP_DIVE_ATTEMPTS - 1 }),
    ]);
    const logger = new RecordingLogger();
    const handler = createDeepDiveHandler({
      tenantDb,
      createCrawler: () => fakeCrawler({ pages: [], partialFailures: [], abortedHosts: [] }),
      promptRuntime: dummyRuntime,
      logger,
      analyzeDossier: () => Promise.reject(new Error("呼ばれない想定")),
    });

    await handler(jobPayload()); // throw しない
    const failed = tenantDb.findQuery(/set state = 'failed'/);
    expect(failed).toBeDefined();
    expect(String(failed?.values?.[1])).toContain("CRAWL_ALL_FAILED");
    expect(logger.errors.some((entry) => entry.message.includes("失敗を確定"))).toBe(true);
  });

  it("企業ドメイン未設定は permanent 失敗（初回でも failed 確定・クローラを呼ばない）", async () => {
    const tenantDb = new FakeTenantDb();
    tenantDb.respond(/from deep_dive_jobs j/, [contextRow({ company_domain: null })]);
    let crawlerCreated = false;
    const handler = createDeepDiveHandler({
      tenantDb,
      createCrawler: () => {
        crawlerCreated = true;
        return fakeCrawler({ pages: [], partialFailures: [], abortedHosts: [] });
      },
      promptRuntime: dummyRuntime,
      logger: new RecordingLogger(),
      analyzeDossier: () => Promise.reject(new Error("呼ばれない想定")),
    });
    await handler(jobPayload());
    expect(crawlerCreated).toBe(false);
    expect(tenantDb.findQuery(/set state = 'failed'/)).toBeDefined();
  });

  it("collecting フェーズタイムアウト → CRAWL_ALL_FAILED（10 分 — テストでは短縮値）", async () => {
    const tenantDb = new FakeTenantDb();
    tenantDb.respond(/from deep_dive_jobs j/, [contextRow()]);
    const handler = createDeepDiveHandler({
      tenantDb,
      createCrawler: () => fakeCrawler(() => new Promise<never>(() => {})),
      promptRuntime: dummyRuntime,
      logger: new RecordingLogger(),
      analyzeDossier: () => Promise.reject(new Error("呼ばれない想定")),
      timeouts: { collectingMs: 20 },
    });
    await expect(handler(jobPayload())).rejects.toMatchObject({
      code: "CRAWL_ALL_FAILED",
      message: expect.stringContaining("タイムアウト"),
    });
  });

  it("analyzing フェーズタイムアウト → LLM_UNAVAILABLE（3 分 — テストでは短縮値）", async () => {
    const tenantDb = new FakeTenantDb();
    tenantDb.respond(/from deep_dive_jobs j/, [contextRow()]);
    const handler = createDeepDiveHandler({
      tenantDb,
      createCrawler: () =>
        fakeCrawler({
          pages: [page("https://example.co.jp/about", "本文")],
          partialFailures: [],
          abortedHosts: [],
        }),
      promptRuntime: dummyRuntime,
      logger: new RecordingLogger(),
      analyzeDossier: () => new Promise<never>(() => {}),
      timeouts: { analyzingMs: 20 },
    });
    await expect(handler(jobPayload())).rejects.toMatchObject({ code: "LLM_UNAVAILABLE" });
  });

  it("PromptError はコードを保って error に写る（LLM_OUTPUT_INVALID）", async () => {
    const tenantDb = new FakeTenantDb();
    tenantDb.respond(/from deep_dive_jobs j/, [
      contextRow({ attempts: MAX_DEEP_DIVE_ATTEMPTS - 1 }),
    ]);
    const handler = createDeepDiveHandler({
      tenantDb,
      createCrawler: () =>
        fakeCrawler({
          pages: [page("https://example.co.jp/about", "本文")],
          partialFailures: [],
          abortedHosts: [],
        }),
      promptRuntime: dummyRuntime,
      logger: new RecordingLogger(),
      analyzeDossier: () =>
        Promise.reject(new PromptError("LLM_OUTPUT_INVALID", "検証失敗（再試行後）")),
    });
    await handler(jobPayload());
    expect(String(tenantDb.findQuery(/set state = 'failed'/)?.values?.[1])).toContain(
      "LLM_OUTPUT_INVALID",
    );
  });

  it("ジョブ行なし・終端状態は no-op（コミット失敗のゴーストジョブ耐性）", async () => {
    const tenantDb = new FakeTenantDb(); // 行なし
    const logger = new RecordingLogger();
    const handler = createDeepDiveHandler({
      tenantDb,
      createCrawler: () => fakeCrawler({ pages: [], partialFailures: [], abortedHosts: [] }),
      promptRuntime: dummyRuntime,
      logger,
      analyzeDossier: () => Promise.reject(new Error("呼ばれない想定")),
    });
    await handler(jobPayload());
    expect(tenantDb.findQuery(/set state = 'collecting'/)).toBeUndefined();
    expect(logger.infos.some((entry) => entry.message.includes("スキップ"))).toBe(true);

    const doneDb = new FakeTenantDb();
    doneDb.respond(/from deep_dive_jobs j/, [contextRow({ state: "done" })]);
    const handler2 = createDeepDiveHandler({
      tenantDb: doneDb,
      createCrawler: () => fakeCrawler({ pages: [], partialFailures: [], abortedHosts: [] }),
      promptRuntime: dummyRuntime,
      logger,
      analyzeDossier: () => Promise.reject(new Error("呼ばれない想定")),
    });
    await handler2(jobPayload());
    expect(doneDb.findQuery(/set state = 'collecting'/)).toBeUndefined();
  });
});
