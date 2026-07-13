import { describe, expect, it } from "vitest";
import {
  deepDiveJobStateSchema,
  entryStatusSchema,
  errorCodeSchema,
  fetchErrorKindSchema,
  messageJobStateSchema,
  roleSchema,
  signalKindSchema,
  warningCodeSchema,
} from "../src/index.js";

describe("enum スキーマ", () => {
  it.each([
    [roleSchema, ["admin", "member"]],
    [entryStatusSchema, ["not_started", "generated", "sent", "replied"]],
    [signalKindSchema, ["job_posting", "tech_blog", "press_release"]],
    [deepDiveJobStateSchema, ["queued", "collecting", "analyzing", "done", "failed"]],
    [
      fetchErrorKindSchema,
      [
        "http_4xx",
        "http_5xx",
        "timeout",
        "robots_denied",
        "connection_error",
        "too_large",
        "redirect_error",
      ],
    ],
    [messageJobStateSchema, ["queued", "generating", "done", "failed"]],
  ] as const)("定義された全値を受理する", (schema, values) => {
    for (const value of values) {
      expect(schema.parse(value)).toBe(value);
    }
  });

  it("enum 外の値を拒否する", () => {
    expect(roleSchema.safeParse("owner").success).toBe(false);
    expect(entryStatusSchema.safeParse("archived").success).toBe(false);
    expect(signalKindSchema.safeParse("sns").success).toBe(false);
    expect(deepDiveJobStateSchema.safeParse("running").success).toBe(false);
    expect(fetchErrorKindSchema.safeParse("dns_error").success).toBe(false);
    expect(messageJobStateSchema.safeParse("collecting").success).toBe(false);
    expect(roleSchema.safeParse("").success).toBe(false);
    expect(roleSchema.safeParse(null).success).toBe(false);
  });

  it("WarningCode は design-detail 3.5 の全コードを受理する", () => {
    const codes = [
      "SKELETON_MISSING",
      "LENGTH_EXCEEDED",
      "URL_IN_OUTPUT",
      "DELIMITER_TAG_IN_OUTPUT",
      "INJECTION_PATTERN_REFLECTED",
      "OFF_TOPIC_SUSPECTED",
      "EVIDENCE_URL_UNKNOWN",
    ];
    for (const code of codes) {
      expect(warningCodeSchema.parse(code)).toBe(code);
    }
    expect(warningCodeSchema.options).toHaveLength(codes.length);
    expect(warningCodeSchema.safeParse("UNKNOWN_WARNING").success).toBe(false);
  });

  it("ErrorCode は design-detail 2.5 の表の全コードを受理する", () => {
    const codes = [
      "AUTH_UNAUTHENTICATED",
      "AUTH_FORBIDDEN",
      "VALIDATION_FAILED",
      "RESOURCE_NOT_FOUND",
      "RESOURCE_CONFLICT",
      "JOB_ALREADY_RUNNING",
      "RATE_LIMITED",
      "LLM_UNAVAILABLE",
      "LLM_OUTPUT_INVALID",
      "CRAWL_ALL_FAILED",
      "INTERNAL",
    ];
    for (const code of codes) {
      expect(errorCodeSchema.parse(code)).toBe(code);
    }
    expect(errorCodeSchema.options).toHaveLength(codes.length);
    expect(errorCodeSchema.safeParse("NOT_A_CODE").success).toBe(false);
    // 小文字は拒否（SCREAMING_SNAKE 形式）
    expect(errorCodeSchema.safeParse("internal").success).toBe(false);
  });
});
