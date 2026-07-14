import { describe, expect, it } from "vitest";
import { loadApiConfig } from "../src/config.js";

const VALID_ENV = {
  DATABASE_URL: "postgresql://app_user:pw@localhost:5432/isreach",
  BATCH_DATABASE_URL: "postgresql://app_batch:pw@localhost:5432/isreach",
  SUPABASE_JWT_SECRET: "0123456789abcdef0123456789abcdef",
};

describe("loadApiConfig（起動時致命エラー方式）", () => {
  it("正常系: 必須変数が揃っていれば ApiConfig を返す（PORT 既定 3001・任意機能は無効）", () => {
    const config = loadApiConfig(VALID_ENV);
    expect(config).toMatchObject({
      port: 3001,
      appUserDatabaseUrl: VALID_ENV.DATABASE_URL,
      batchDatabaseUrl: VALID_ENV.BATCH_DATABASE_URL,
      supabaseJwtSecret: VALID_ENV.SUPABASE_JWT_SECRET,
      supabaseAdmin: null,
      authHookSecret: null,
      signalSeeds: [],
      signalCollectionCron: "0 18 * * *", // 仮置き: 日次深夜帯（JST 03:00）
    });
    // prompt 設定（E2）が合成されている
    expect(config.prompt.dossier.modelId).not.toHaveLength(0);
    expect(config.prompt.message.modelId).not.toHaveLength(0);
  });

  it("SIGNAL_SEEDS（JSON）を検証して受理する", () => {
    const config = loadApiConfig({
      ...VALID_ENV,
      SIGNAL_SEEDS: JSON.stringify([{ url: "https://example.co.jp/careers", kind: "job_posting" }]),
    });
    expect(config.signalSeeds).toEqual([
      { url: "https://example.co.jp/careers", kind: "job_posting" },
    ]);
  });

  it("SIGNAL_SEEDS の不正 JSON・enum 外 kind を拒否する", () => {
    expect(() => loadApiConfig({ ...VALID_ENV, SIGNAL_SEEDS: "{broken" })).toThrowError(
      /SIGNAL_SEEDS/,
    );
    expect(() =>
      loadApiConfig({
        ...VALID_ENV,
        SIGNAL_SEEDS: JSON.stringify([{ url: "https://a.example", kind: "sns" }]),
      }),
    ).toThrowError(/SIGNAL_SEEDS/);
  });

  it("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は片方だけの指定を拒否する", () => {
    expect(() =>
      loadApiConfig({ ...VALID_ENV, SUPABASE_URL: "https://x.supabase.co" }),
    ).toThrowError(/SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY/);
    const config = loadApiConfig({
      ...VALID_ENV,
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    });
    expect(config.supabaseAdmin).toEqual({
      url: "https://x.supabase.co",
      serviceRoleKey: "service-role-key",
    });
  });

  it("PROMPT_* 環境変数が prompt 設定へ反映される（E2）", () => {
    const config = loadApiConfig({ ...VALID_ENV, PROMPT_DOSSIER_MODEL_ID: "claude-test-model" });
    expect(config.prompt.dossier.modelId).toBe("claude-test-model");
  });

  it("PORT を数値化して受理する", () => {
    expect(loadApiConfig({ ...VALID_ENV, PORT: "8080" }).port).toBe(8080);
  });

  it("必須変数の欠落は対象キー名を含むエラーで落ちる", () => {
    const { DATABASE_URL: _omit, ...withoutDbUrl } = VALID_ENV;
    expect(() => loadApiConfig(withoutDbUrl)).toThrowError(/DATABASE_URL/);
  });

  it("postgres 以外のスキームの接続文字列を拒否する", () => {
    expect(() =>
      loadApiConfig({ ...VALID_ENV, BATCH_DATABASE_URL: "mysql://localhost/x" }),
    ).toThrowError(/BATCH_DATABASE_URL/);
  });

  it("短すぎる SUPABASE_JWT_SECRET を拒否する（メッセージに秘密値を含めない）", () => {
    let caught: unknown;
    try {
      loadApiConfig({ ...VALID_ENV, SUPABASE_JWT_SECRET: "short" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toMatch(/SUPABASE_JWT_SECRET/);
    expect(message).not.toContain("short");
  });

  it("不正な PORT（非整数・範囲外）を拒否する", () => {
    expect(() => loadApiConfig({ ...VALID_ENV, PORT: "abc" })).toThrowError(/PORT/);
    expect(() => loadApiConfig({ ...VALID_ENV, PORT: "70000" })).toThrowError(/PORT/);
  });

  it("複数の違反をまとめて報告する", () => {
    expect(() => loadApiConfig({})).toThrowError(
      /DATABASE_URL[\s\S]*BATCH_DATABASE_URL[\s\S]*SUPABASE_JWT_SECRET/,
    );
  });
});
