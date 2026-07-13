// テスト共通ヘルパ。実 API・実ネットワークは一切使わない（LlmClient のモックを注入する）。
import { markUntrusted, type Template, type UntrustedText } from "@is-reach/shared";
import type { LlmClient, LlmRequest, LlmResponse } from "../src/llm/client.js";

/** モック応答の 1 ステップ（応答を返すか、エラーを投げるか） */
export type FakeStep = { response: LlmResponse } | { error: Error };

/**
 * LlmClient のモック。ステップ列を順に消費し、受け取ったリクエストをすべて記録する。
 * ステップを使い切った後の呼び出しはテスト失敗として例外を投げる。
 */
export class FakeLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = [];
  private readonly steps: FakeStep[];

  constructor(steps: readonly FakeStep[]) {
    this.steps = [...steps];
  }

  complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const step = this.steps.shift();
    if (step === undefined) {
      throw new Error("FakeLlmClient: 想定外の追加呼び出し（ステップを使い切った）");
    }
    if ("error" in step) {
      return Promise.reject(step.error);
    }
    return Promise.resolve(step.response);
  }
}

/** toolInput を 1 回返すだけのモック応答を作る */
export function ok(toolInput: unknown, modelId = "test-model"): FakeStep {
  return { response: { toolInput, modelId } };
}

/** UntrustedText を短く作る */
export function untrusted(
  text: string,
  sourceUrl = "https://example.co.jp/company",
  collectedAt = "2026-07-10T02:00:00Z",
): UntrustedText {
  return markUntrusted({ text, sourceUrl, collectedAt });
}

/** 妥当なドシエ LLM 出力（evidence は指定 URL）を作る */
export function dossierOutput(evidenceUrl = "https://example.co.jp/company"): unknown {
  const section = {
    body: "事業サマリ本文",
    evidence: { kind: "sources", urls: [evidenceUrl] },
  };
  return {
    businessSummary: section,
    inferredIssues: [{ body: "推定課題の本文", evidence: { kind: "none" } }],
    serviceHooks: [section],
  };
}

/** 妥当な Template（shared 契約に適合）を作る */
export function template(overrides: Partial<Template> = {}): Template {
  return {
    id: "018f4a1e-0000-7000-8000-000000000001",
    name: "標準テンプレート",
    introduction: "私たちは is-reach を提供する株式会社イズリーチです。",
    cta: "ご興味があれば 30 分ほどの情報交換の機会をいただけますと幸いです。",
    tone: "丁寧・簡潔",
    maxLength: 800,
    createdBy: "018f4a1e-0000-7000-8000-000000000002",
    updatedAt: "2026-07-10T02:00:00Z",
    ...overrides,
  };
}
