import { describe, expect, it } from "vitest";
import { dossierSchema, evidenceSchema } from "../src/index.js";
import { HTTPS_URL, ISO_AT, UUID_A, UUID_B } from "./helpers.js";

describe("evidenceSchema（要件 F3: 根拠なしを明示できる判別可能な型）", () => {
  it("sources: 出典 URL 1 件以上で受理する", () => {
    const parsed = evidenceSchema.parse({ kind: "sources", urls: [HTTPS_URL] });
    expect(parsed).toEqual({ kind: "sources", urls: [HTTPS_URL] });
  });

  it("sources: urls の空配列を拒否する（出典なしは型検査を通らない — basic-design 8.2）", () => {
    expect(evidenceSchema.safeParse({ kind: "sources", urls: [] }).success).toBe(false);
  });

  it("sources: urls の欠落・https? 以外の URL を拒否する", () => {
    expect(evidenceSchema.safeParse({ kind: "sources" }).success).toBe(false);
    expect(
      evidenceSchema.safeParse({ kind: "sources", urls: ["javascript:alert(1)"] }).success,
    ).toBe(false);
    expect(evidenceSchema.safeParse({ kind: "sources", urls: ["not a url"] }).success).toBe(false);
  });

  it("none: 「根拠なし」の明示を受理する", () => {
    expect(evidenceSchema.parse({ kind: "none" })).toEqual({ kind: "none" });
  });

  it("判別子が不正なら拒否する", () => {
    expect(evidenceSchema.safeParse({ kind: "unknown" }).success).toBe(false);
    expect(evidenceSchema.safeParse({}).success).toBe(false);
  });
});

describe("dossierSchema", () => {
  const validDossier = {
    id: UUID_A,
    listEntryId: UUID_B,
    businessSummary: { body: "SaaS を提供", evidence: { kind: "sources", urls: [HTTPS_URL] } },
    inferredIssues: [{ body: "採用強化中と推定", evidence: { kind: "none" } }],
    serviceHooks: [],
    sources: [{ url: HTTPS_URL, fetchedAt: ISO_AT, title: "ニュース" }],
    warnings: [{ code: "EVIDENCE_URL_UNKNOWN", detail: "収集ソース外 URL を除去" }],
    modelId: "claude-sonnet-5",
    generatedAt: ISO_AT,
  };

  it("正常系（根拠あり・根拠なしセクションの混在）", () => {
    const parsed = dossierSchema.parse(validDossier);
    expect(parsed.inferredIssues[0]?.evidence.kind).toBe("none");
  });

  it("必須欠落（modelId・generatedAt）を拒否する", () => {
    const { modelId: _modelId, ...withoutModel } = validDossier;
    expect(dossierSchema.safeParse(withoutModel).success).toBe(false);
    const { generatedAt: _generatedAt, ...withoutGeneratedAt } = validDossier;
    expect(dossierSchema.safeParse(withoutGeneratedAt).success).toBe(false);
  });

  it("警告コードが enum 外なら拒否する", () => {
    expect(
      dossierSchema.safeParse({
        ...validDossier,
        warnings: [{ code: "MADE_UP", detail: "" }],
      }).success,
    ).toBe(false);
  });
});
