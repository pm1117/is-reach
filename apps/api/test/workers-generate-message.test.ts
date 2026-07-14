// メッセージ生成ワーカー（E13）のテスト。prompt は注入モック。
// 警告伝播（validation.warnings → messages 行 + message.generated metadata）と
// リトライ / permanent 失敗の分岐を検証する。
import type {
  MessageGenerationInput,
  MessageGenerationResult,
  PromptRuntime,
} from "@is-reach/prompt";
import { PromptError } from "@is-reach/prompt";
import { describe, expect, it } from "vitest";
import {
  createGenerateMessageHandler,
  dossierSectionsToUntrusted,
  MAX_GENERATE_MESSAGE_ATTEMPTS,
} from "../src/workers/generate-message.js";
import { JobFailure } from "../src/workers/util.js";
import { FakeTenantDb, RecordingLogger, TEST_TENANT_ID, TEST_USER_ID } from "./helpers.js";

const MESSAGE_JOB_ID = "99999999-9999-4999-8999-999999999999";
const ENTRY_ID = "44444444-4444-4444-8444-444444444444";
const TEMPLATE_ID = "66666666-6666-4666-8666-666666666666";
const DOSSIER_ID = "77777777-7777-4777-8777-777777777777";
const MESSAGE_ID = "88888888-8888-4888-8888-888888888888";
const AT = "2026-07-14T00:00:00.000Z";

const dummyRuntime: PromptRuntime = {
  client: {
    complete: () => Promise.reject(new Error("モック注入済みのため LLM クライアントは呼ばれない")),
  },
};

function jobContextRow(overrides: Record<string, unknown> = {}) {
  return {
    state: "queued",
    attempts: 0,
    list_entry_id: ENTRY_ID,
    template_id: TEMPLATE_ID,
    created_by: TEST_USER_ID,
    service_summary: "リサーチ自動化 SaaS",
    ...overrides,
  };
}

function templateRow() {
  return {
    id: TEMPLATE_ID,
    name: "標準テンプレート",
    introduction: "自社紹介",
    cta: "CTA",
    tone: "polite",
    max_length: 600,
    created_by: TEST_USER_ID,
    updated_at: AT,
  };
}

function dossierRow() {
  return {
    id: DOSSIER_ID,
    list_entry_id: ENTRY_ID,
    business_summary: {
      body: "事業サマリ",
      evidence: { kind: "sources", urls: ["https://example.co.jp/about"] },
    },
    inferred_issues: [{ body: "採用課題", evidence: { kind: "none" } }],
    service_hooks: [],
    sources: [{ url: "https://example.co.jp/about", fetchedAt: AT, title: "会社概要" }],
    warnings: [],
    model_id: "claude-sonnet-test",
    generated_at: AT,
  };
}

function generationResult(warnings: MessageGenerationResult["validation"]["warnings"] = []) {
  return {
    parts: { hook: "接点", issueMention: "課題言及", introduction: "自社紹介", cta: "CTA" },
    assembledBody: "接点\n\n自社紹介\n\n課題言及\n\nCTA",
    validation: { ok: warnings.length === 0, warnings },
    sources: [],
    modelId: "claude-haiku-test",
  } satisfies MessageGenerationResult;
}

function readyDb(overrides: Record<string, unknown> = {}) {
  const db = new FakeTenantDb();
  db.respond(/from message_jobs j/, [jobContextRow(overrides)]);
  db.respond(/from templates where id/, [templateRow()]);
  db.respond(/from dossiers where list_entry_id/, [dossierRow()]);
  db.respond(/insert into messages/, [{ id: MESSAGE_ID }]);
  return db;
}

function job() {
  return {
    id: "pgboss-2",
    name: "generate_message" as const,
    payload: { messageJobId: MESSAGE_JOB_ID, tenantId: TEST_TENANT_ID },
  };
}

describe("generate_message ワーカー", () => {
  it("成功系: 生成 → messages 保存 → done → message.generated（警告有無を metadata に）", async () => {
    const tenantDb = readyDb();
    const inputs: MessageGenerationInput[] = [];
    const handler = createGenerateMessageHandler({
      tenantDb,
      promptRuntime: dummyRuntime,
      logger: new RecordingLogger(),
      generateMessageParts: async (input) => {
        inputs.push(input);
        return generationResult([{ code: "LENGTH_EXCEEDED", detail: "超過" }]);
      },
    });

    await handler(job());

    expect(tenantDb.findQuery(/set state = 'generating'/)).toBeDefined();
    const insert = tenantDb.findQuery(/insert into messages/);
    expect(insert).toBeDefined();
    expect(String(insert?.values?.[6])).toContain("LENGTH_EXCEEDED"); // validation.warnings
    const done = tenantDb.findQuery(/set state = 'done'/);
    expect(done?.values).toEqual([MESSAGE_JOB_ID, MESSAGE_ID]);
    const audit = tenantDb.findQuery(/insert into audit_logs/);
    expect(audit?.values?.[2]).toBe("message.generated");
    expect(audit?.values?.[1]).toBe(TEST_USER_ID); // 起動ユーザーを引き継ぐ（7.2）
    expect(String(audit?.values?.[5])).toContain('"warned":true');
    // 生成入力: 骨子は Template から・ドシエ各セクションは UntrustedText
    expect(inputs[0]?.template.introduction).toBe("自社紹介");
    expect(inputs[0]?.dossierSections.length).toBeGreaterThan(0);
  });

  it("evidence なしセクションはドシエ収集ソース先頭の URL にフォールバックする", () => {
    const sections = dossierSectionsToUntrusted({
      businessSummary: {
        body: "事業サマリ",
        evidence: { kind: "sources", urls: ["https://example.co.jp/about"] },
      },
      inferredIssues: [{ body: "採用課題", evidence: { kind: "none" } }],
      serviceHooks: [],
      sources: [{ url: "https://example.co.jp/about" }],
      generatedAt: AT,
    });
    expect(sections).toHaveLength(2);
    expect(sections[1]?.content.sourceUrl).toBe("https://example.co.jp/about");
  });

  it("テンプレートが削除済み → permanent 失敗（初回でも failed 確定・LLM を呼ばない）", async () => {
    const tenantDb = new FakeTenantDb();
    tenantDb.respond(/from message_jobs j/, [jobContextRow({ template_id: null })]);
    let generated = false;
    const handler = createGenerateMessageHandler({
      tenantDb,
      promptRuntime: dummyRuntime,
      logger: new RecordingLogger(),
      generateMessageParts: async () => {
        generated = true;
        return generationResult();
      },
    });
    await handler(job());
    expect(generated).toBe(false);
    expect(String(tenantDb.findQuery(/set state = 'failed'/)?.values?.[1])).toContain(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("一時失敗（LLM_UNAVAILABLE）は初回 → queued へ戻して throw、最終試行 → failed 確定", async () => {
    const firstDb = readyDb();
    const failingHandler = (tenantDb: FakeTenantDb) =>
      createGenerateMessageHandler({
        tenantDb,
        promptRuntime: dummyRuntime,
        logger: new RecordingLogger(),
        generateMessageParts: () =>
          Promise.reject(new PromptError("LLM_UNAVAILABLE", "リトライ上限")),
      });
    await expect(failingHandler(firstDb)(job())).rejects.toThrowError(JobFailure);
    expect(firstDb.findQuery(/set state = 'queued'/)).toBeDefined();
    expect(firstDb.findQuery(/set state = 'failed'/)).toBeUndefined();

    const finalDb = readyDb({ attempts: MAX_GENERATE_MESSAGE_ATTEMPTS - 1 });
    await failingHandler(finalDb)(job()); // throw しない
    expect(String(finalDb.findQuery(/set state = 'failed'/)?.values?.[1])).toContain(
      "LLM_UNAVAILABLE",
    );
  });

  it("ジョブ行なし・終端状態は no-op", async () => {
    const tenantDb = new FakeTenantDb();
    const logger = new RecordingLogger();
    const handler = createGenerateMessageHandler({
      tenantDb,
      promptRuntime: dummyRuntime,
      logger,
      generateMessageParts: () => Promise.reject(new Error("呼ばれない想定")),
    });
    await handler(job());
    expect(tenantDb.findQuery(/set state = 'generating'/)).toBeUndefined();
    expect(logger.infos.some((entry) => entry.message.includes("スキップ"))).toBe(true);
  });
});
