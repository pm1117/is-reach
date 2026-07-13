import { describe, expect, it } from "vitest";
import {
  createListRequestSchema,
  screeningSearchRequestSchema,
  screeningSearchResponseSchema,
} from "../src/index.js";
import { HTTPS_URL, ISO_AT, UUID_A, UUID_B } from "./helpers.js";

describe("screeningSearchRequestSchema", () => {
  it("空リクエストでも limit 既定 200 が入る", () => {
    const parsed = screeningSearchRequestSchema.parse({});
    expect(parsed.limit).toBe(200);
  });

  it("条件付きの正常系", () => {
    const parsed = screeningSearchRequestSchema.parse({
      attributes: { industries: ["SaaS"], employeeRanges: ["r_50_100"], regions: ["tokyo"] },
      signals: { kinds: ["job_posting"], keywords: ["React"], freshWithinDays: 30 },
      limit: 500,
    });
    expect(parsed.limit).toBe(500);
    expect(parsed.signals?.kinds).toEqual(["job_posting"]);
  });

  it("limit の境界値: 500 は受理・501 と 0 は拒否", () => {
    expect(screeningSearchRequestSchema.safeParse({ limit: 500 }).success).toBe(true);
    expect(screeningSearchRequestSchema.safeParse({ limit: 501 }).success).toBe(false);
    expect(screeningSearchRequestSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(screeningSearchRequestSchema.safeParse({ limit: 1.5 }).success).toBe(false);
    // JSON ボディのため文字列は暗黙変換しない（coerce なし）
    expect(screeningSearchRequestSchema.safeParse({ limit: "200" }).success).toBe(false);
  });

  it("enum 外のシグナル種別・不正な freshWithinDays を拒否する", () => {
    expect(screeningSearchRequestSchema.safeParse({ signals: { kinds: ["sns"] } }).success).toBe(
      false,
    );
    expect(
      screeningSearchRequestSchema.safeParse({ signals: { freshWithinDays: 0 } }).success,
    ).toBe(false);
  });
});

describe("screeningSearchResponseSchema", () => {
  const validResult = {
    company: {
      id: UUID_A,
      name: "株式会社サンプル",
      domain: "example.co.jp",
      industry: "SaaS",
      employeeRange: "r_50_100",
      region: "tokyo",
    },
    score: 42,
    matchedSignals: [
      {
        signalId: UUID_B,
        kind: "job_posting",
        summary: "React エンジニア募集",
        sourceUrl: HTTPS_URL,
        collectedAt: ISO_AT,
      },
    ],
  };

  it("正常系", () => {
    const parsed = screeningSearchResponseSchema.parse({ results: [validResult], total: 1 });
    expect(parsed.results[0]?.matchedSignals[0]?.kind).toBe("job_posting");
  });

  it("マッチ根拠の sourceUrl は https? 以外を拒否する", () => {
    const bad = {
      ...validResult,
      matchedSignals: [{ ...validResult.matchedSignals[0], sourceUrl: "ftp://example.co.jp/file" }],
    };
    expect(screeningSearchResponseSchema.safeParse({ results: [bad], total: 1 }).success).toBe(
      false,
    );
  });

  it("collectedAt の必須欠落を拒否する（根拠には収集日時が必ず付く）", () => {
    const { collectedAt: _collectedAt, ...signalWithoutCollectedAt } =
      validResult.matchedSignals[0]!;
    const bad = { ...validResult, matchedSignals: [signalWithoutCollectedAt] };
    expect(screeningSearchResponseSchema.safeParse({ results: [bad], total: 1 }).success).toBe(
      false,
    );
  });
});

describe("createListRequestSchema", () => {
  const base = {
    name: "7月ターゲット",
    searchCondition: { limit: 200 },
    companyIds: [UUID_A],
  };

  it("正常系（searchCondition は検索条件スナップショット）", () => {
    const parsed = createListRequestSchema.parse(base);
    expect(parsed.searchCondition.limit).toBe(200);
  });

  it("名前が空・companyIds が空配列なら拒否する", () => {
    expect(createListRequestSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(createListRequestSchema.safeParse({ ...base, companyIds: [] }).success).toBe(false);
  });

  it("companyIds に UUID 以外が混ざると拒否する", () => {
    expect(createListRequestSchema.safeParse({ ...base, companyIds: ["not-a-uuid"] }).success).toBe(
      false,
    );
  });
});
