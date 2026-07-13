import { describe, expect, it } from "vitest";
import { deletionRequestSchema, deletionResponseSchema } from "../src/index.js";
import { UUID_A, UUID_B } from "./helpers.js";

describe("deletionRequestSchema（scope と対象 ID の整合 — 決定 E4）", () => {
  it("scope=entry: entryId ありで受理する", () => {
    const parsed = deletionRequestSchema.parse({
      scope: "entry",
      entryId: UUID_A,
      reason: "削除依頼メール（2026-07-01 受領）",
    });
    expect(parsed.entryId).toBe(UUID_A);
  });

  it("scope=entry: entryId 欠落を拒否する", () => {
    expect(deletionRequestSchema.safeParse({ scope: "entry", reason: "依頼" }).success).toBe(false);
  });

  it("scope=entry: companyId の同時指定を拒否する（対象の曖昧さを許さない）", () => {
    expect(
      deletionRequestSchema.safeParse({
        scope: "entry",
        entryId: UUID_A,
        companyId: UUID_B,
        reason: "依頼",
      }).success,
    ).toBe(false);
  });

  it("scope=company: companyId ありで受理する", () => {
    const parsed = deletionRequestSchema.parse({
      scope: "company",
      companyId: UUID_B,
      reason: "企業からの削除依頼",
    });
    expect(parsed.companyId).toBe(UUID_B);
  });

  it("scope=company: companyId 欠落・entryId の同時指定を拒否する", () => {
    expect(deletionRequestSchema.safeParse({ scope: "company", reason: "依頼" }).success).toBe(
      false,
    );
    expect(
      deletionRequestSchema.safeParse({
        scope: "company",
        companyId: UUID_B,
        entryId: UUID_A,
        reason: "依頼",
      }).success,
    ).toBe(false);
  });

  it("reason の空文字・scope の enum 外を拒否する", () => {
    expect(
      deletionRequestSchema.safeParse({ scope: "entry", entryId: UUID_A, reason: "" }).success,
    ).toBe(false);
    expect(deletionRequestSchema.safeParse({ scope: "tenant", reason: "依頼" }).success).toBe(
      false,
    );
  });
});

describe("deletionResponseSchema", () => {
  it("正常系（カスケード削除の件数）", () => {
    const parsed = deletionResponseSchema.parse({
      deleted: { dossiers: 1, messages: 3, collectedDocuments: 12, entries: 1 },
    });
    expect(parsed.deleted.messages).toBe(3);
  });

  it("負数・欠落を拒否する", () => {
    expect(
      deletionResponseSchema.safeParse({
        deleted: { dossiers: -1, messages: 0, collectedDocuments: 0, entries: 0 },
      }).success,
    ).toBe(false);
    expect(deletionResponseSchema.safeParse({ deleted: {} }).success).toBe(false);
  });
});
