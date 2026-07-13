import { describe, expect, it } from "vitest";
import { templateSchema } from "../src/index.js";
import { ISO_AT, UUID_A, UUID_B } from "./helpers.js";

describe("templateSchema", () => {
  const validTemplate = {
    id: UUID_A,
    name: "初回接触（SaaS 向け）",
    introduction: "私たちは〜を提供する会社です",
    cta: "オンラインで 15 分お話しできませんか",
    tone: "丁寧・簡潔",
    maxLength: 800,
    createdBy: UUID_B,
    updatedAt: ISO_AT,
  };

  it("正常系", () => {
    expect(templateSchema.parse(validTemplate).maxLength).toBe(800);
  });

  it("骨子（introduction / cta）の空文字・欠落を拒否する", () => {
    expect(templateSchema.safeParse({ ...validTemplate, introduction: "" }).success).toBe(false);
    expect(templateSchema.safeParse({ ...validTemplate, cta: "" }).success).toBe(false);
    const { cta: _cta, ...withoutCta } = validTemplate;
    expect(templateSchema.safeParse(withoutCta).success).toBe(false);
  });

  it("maxLength の 0 以下・非整数を拒否する", () => {
    expect(templateSchema.safeParse({ ...validTemplate, maxLength: 0 }).success).toBe(false);
    expect(templateSchema.safeParse({ ...validTemplate, maxLength: -1 }).success).toBe(false);
    expect(templateSchema.safeParse({ ...validTemplate, maxLength: 10.5 }).success).toBe(false);
  });
});
