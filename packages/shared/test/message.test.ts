import { describe, expect, it } from "vitest";
import {
  generateMessageRequestSchema,
  generateMessageResponseSchema,
  messageJobSchema,
  messageSchema,
} from "../src/index.js";
import { ISO_AT, UUID_A, UUID_B, UUID_C } from "./helpers.js";

describe("generateMessageRequestSchema / ResponseSchema", () => {
  it("正常系", () => {
    expect(generateMessageRequestSchema.parse({ templateId: UUID_A }).templateId).toBe(UUID_A);
    expect(generateMessageResponseSchema.parse({ jobId: UUID_B }).jobId).toBe(UUID_B);
  });

  it("templateId の欠落・UUID 以外を拒否する", () => {
    expect(generateMessageRequestSchema.safeParse({}).success).toBe(false);
    expect(generateMessageRequestSchema.safeParse({ templateId: "abc" }).success).toBe(false);
  });
});

describe("messageJobSchema", () => {
  const base = {
    id: UUID_A,
    listEntryId: UUID_B,
    state: "queued",
    messageId: null,
    error: null,
    createdAt: ISO_AT,
    updatedAt: ISO_AT,
  };

  it("正常系（done 時に messageId 設定）", () => {
    expect(messageJobSchema.parse(base).messageId).toBeNull();
    expect(messageJobSchema.parse({ ...base, state: "done", messageId: UUID_C }).messageId).toBe(
      UUID_C,
    );
  });

  it("enum 外の state を拒否する", () => {
    expect(messageJobSchema.safeParse({ ...base, state: "analyzing" }).success).toBe(false);
  });

  it("state と messageId の相関: done なのに messageId null / done 以外で設定は拒否", () => {
    expect(messageJobSchema.safeParse({ ...base, state: "done", messageId: null }).success).toBe(
      false,
    );
    expect(
      messageJobSchema.safeParse({ ...base, state: "queued", messageId: UUID_C }).success,
    ).toBe(false);
  });

  it("state と error の相関: failed なのに error null / failed 以外で設定は拒否", () => {
    expect(messageJobSchema.safeParse({ ...base, state: "failed", error: null }).success).toBe(
      false,
    );
    expect(
      messageJobSchema.parse({
        ...base,
        state: "failed",
        error: { code: "LLM_UNAVAILABLE", message: "リトライ上限に到達しました" },
      }).error?.code,
    ).toBe("LLM_UNAVAILABLE");
    expect(
      messageJobSchema.safeParse({
        ...base,
        state: "generating",
        error: { code: "INTERNAL", message: "x" },
      }).success,
    ).toBe(false);
  });
});

describe("messageSchema", () => {
  const validMessage = {
    id: UUID_A,
    listEntryId: UUID_B,
    templateId: UUID_C,
    dossierId: UUID_A,
    parts: {
      hook: "貴社のプレスリリースを拝見しました",
      issueMention: "採用強化に伴う課題",
      introduction: "私たちは〜を提供しています",
      cta: "15 分ほどお時間いただけますか",
    },
    assembledBody: "全文",
    editedBody: null,
    validation: { ok: false, warnings: [{ code: "LENGTH_EXCEEDED", detail: "1200 > 800" }] },
    modelId: "claude-haiku-4-5",
    generatedAt: ISO_AT,
    editedAt: null,
  };

  it("正常系（警告付き生成の保持 — 最終防衛線は人手確認）", () => {
    const parsed = messageSchema.parse(validMessage);
    expect(parsed.validation.ok).toBe(false);
    expect(parsed.validation.warnings[0]?.code).toBe("LENGTH_EXCEEDED");
  });

  it("parts の必須欠落（骨子 introduction / cta）を拒否する", () => {
    const { cta: _cta, ...partsWithoutCta } = validMessage.parts;
    expect(messageSchema.safeParse({ ...validMessage, parts: partsWithoutCta }).success).toBe(
      false,
    );
  });

  it("編集後の状態（editedBody / editedAt）を受理する", () => {
    const parsed = messageSchema.parse({
      ...validMessage,
      editedBody: "編集済み本文",
      editedAt: ISO_AT,
    });
    expect(parsed.editedBody).toBe("編集済み本文");
  });

  it("validation の欠落を拒否する（検証結果は必須）", () => {
    const { validation: _validation, ...withoutValidation } = validMessage;
    expect(messageSchema.safeParse(withoutValidation).success).toBe(false);
  });
});
