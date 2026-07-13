import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  PLACEHOLDER_BOT_INFO_URL,
  PLACEHOLDER_CONTACT,
  buildUserAgent,
  hasPlaceholderUserAgent,
  resolveCrawlerConfig,
} from "../src/config.js";

describe("resolveCrawlerConfig", () => {
  it("既定値は E12 の決定値", () => {
    const config = resolveCrawlerConfig();
    expect(config.minDomainIntervalMs).toBe(10_000);
    expect(config.maxJitterMs).toBe(5_000);
    expect(config.globalConcurrency).toBe(5);
    expect(config.deepDiveMaxPages).toBe(20);
    expect(config.signalSourceMaxPages).toBe(5);
    expect(config.pageTimeoutMs).toBe(15_000);
    expect(config.maxBodyBytes).toBe(2 * 1024 * 1024);
    expect(config.maxRedirects).toBe(3);
    expect(config.http429MinWaitMs).toBe(60_000);
    expect(config.intervalMultiplierAfter429).toBe(2);
    expect(config.http5xxRetryWaitMs).toBe(5_000);
  });

  it("部分上書きが可能で、それ以外は既定値のまま", () => {
    const config = resolveCrawlerConfig({ deepDiveMaxPages: 5 });
    expect(config.deepDiveMaxPages).toBe(5);
    expect(config.minDomainIntervalMs).toBe(10_000);
  });

  it("不正値（負のページ上限等）は ZodError", () => {
    expect(() => resolveCrawlerConfig({ deepDiveMaxPages: 0 })).toThrow(ZodError);
    expect(() => resolveCrawlerConfig({ minDomainIntervalMs: -1 })).toThrow(ZodError);
  });
});

describe("buildUserAgent（E12）", () => {
  it("既定はプレースホルダ入りの書式どおりの UA", () => {
    const config = resolveCrawlerConfig();
    expect(buildUserAgent(config)).toBe(
      `is-reach-bot/0.1.0 (+${PLACEHOLDER_BOT_INFO_URL}; contact: ${PLACEHOLDER_CONTACT})`,
    );
    expect(hasPlaceholderUserAgent(config)).toBe(true);
  });

  it("実値を設定するとプレースホルダ判定が外れる", () => {
    const config = resolveCrawlerConfig({
      userAgent: {
        version: "1.2.3",
        botInfoUrl: "https://is-reach.example/bot",
        contact: "crawler@is-reach.example",
      },
    });
    expect(buildUserAgent(config)).toBe(
      "is-reach-bot/1.2.3 (+https://is-reach.example/bot; contact: crawler@is-reach.example)",
    );
    expect(hasPlaceholderUserAgent(config)).toBe(false);
  });
});
