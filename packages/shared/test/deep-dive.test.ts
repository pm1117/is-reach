import { describe, expect, it } from "vitest";
import {
  createDeepDiveJobsRequestSchema,
  createDeepDiveJobsResponseSchema,
  deepDiveJobSchema,
} from "../src/index.js";
import { HTTPS_URL, ISO_AT, UUID_A, UUID_B } from "./helpers.js";

const validJob = {
  id: UUID_A,
  listEntryId: UUID_B,
  state: "collecting",
  progress: { fetchedPages: 3, plannedPages: 20 },
  partialFailures: [{ url: HTTPS_URL, reason: "timeout" }],
  error: null,
  attempts: 1,
  createdAt: ISO_AT,
  updatedAt: ISO_AT,
};

describe("createDeepDiveJobsRequestSchema", () => {
  it("entryIds 1 件以上で受理する", () => {
    expect(createDeepDiveJobsRequestSchema.parse({ entryIds: [UUID_A] }).entryIds).toEqual([
      UUID_A,
    ]);
  });

  it("空配列・欠落を拒否する", () => {
    expect(createDeepDiveJobsRequestSchema.safeParse({ entryIds: [] }).success).toBe(false);
    expect(createDeepDiveJobsRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("deepDiveJobSchema", () => {
  it("正常系（plannedPages は null 許容）", () => {
    const parsed = deepDiveJobSchema.parse({
      ...validJob,
      progress: { fetchedPages: 0, plannedPages: null },
    });
    expect(parsed.progress.plannedPages).toBeNull();
  });

  it("failed 時のエラーはエラーコード体系（2.5）に従う", () => {
    const failed = {
      ...validJob,
      state: "failed",
      error: { code: "CRAWL_ALL_FAILED", message: "全ページの取得に失敗しました" },
    };
    expect(deepDiveJobSchema.parse(failed).error?.code).toBe("CRAWL_ALL_FAILED");
    // 体系外のコードは拒否
    expect(
      deepDiveJobSchema.safeParse({
        ...failed,
        error: { code: "SOME_RANDOM_ERROR", message: "x" },
      }).success,
    ).toBe(false);
  });

  it("state と error の相関: failed なのに error null / failed 以外で error 設定は拒否", () => {
    expect(deepDiveJobSchema.safeParse({ ...validJob, state: "failed", error: null }).success).toBe(
      false,
    );
    expect(
      deepDiveJobSchema.safeParse({
        ...validJob,
        state: "collecting",
        error: { code: "INTERNAL", message: "x" },
      }).success,
    ).toBe(false);
  });

  it("enum 外の state・FetchErrorKind を拒否する", () => {
    expect(deepDiveJobSchema.safeParse({ ...validJob, state: "paused" }).success).toBe(false);
    expect(
      deepDiveJobSchema.safeParse({
        ...validJob,
        partialFailures: [{ url: HTTPS_URL, reason: "dns_error" }],
      }).success,
    ).toBe(false);
  });

  it("進捗の負数・非整数を拒否する", () => {
    expect(
      deepDiveJobSchema.safeParse({
        ...validJob,
        progress: { fetchedPages: -1, plannedPages: null },
      }).success,
    ).toBe(false);
    expect(deepDiveJobSchema.safeParse({ ...validJob, attempts: 0.5 }).success).toBe(false);
  });
});

describe("createDeepDiveJobsResponseSchema", () => {
  it("正常系", () => {
    expect(createDeepDiveJobsResponseSchema.parse({ jobs: [validJob] }).jobs).toHaveLength(1);
  });
});
