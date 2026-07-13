// PageFetcher の HTTP エラー分類（design-detail 4.2 — 決定 E10）の検証。
// 実ネットワークには出ない（fetch スタブ + フェイクタイマー）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCrawlerConfig, type CrawlerConfigInput } from "../src/config.js";
import { PageFetcher, parseRetryAfterMs, type PageFetchOutcome } from "../src/page-fetcher.js";
import { PolitenessController } from "../src/politeness.js";
import type { RobotsChecker } from "../src/robots.js";
import {
  FAST_CONFIG,
  createStubFetch,
  htmlResponse,
  redirectResponse,
  type StubFetch,
  type StubHandler,
} from "./helpers.js";

const allowAllRobots: RobotsChecker = { isAllowed: () => Promise.resolve(true) };

function makeFetcher(
  handler: StubHandler,
  configInput: CrawlerConfigInput = FAST_CONFIG,
  robots: RobotsChecker = allowAllRobots,
): { fetcher: PageFetcher; stub: StubFetch; politeness: PolitenessController } {
  const config = resolveCrawlerConfig(configInput);
  const stub = createStubFetch(handler);
  const politeness = new PolitenessController(config, {
    now: () => Date.now(),
    random: () => 0,
  });
  const fetcher = new PageFetcher(
    config,
    { fetchImpl: stub.fetchImpl, now: () => Date.now() },
    politeness,
    robots,
  );
  return { fetcher, stub, politeness };
}

function expectFailure(outcome: PageFetchOutcome, reason: string): void {
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) {
    expect(outcome.reason).toBe(reason);
  }
}

describe("PageFetcher: 成功系", () => {
  it("2xx の HTML から本文・タイトル・リンクを抽出する", async () => {
    const { fetcher } = makeFetcher(() =>
      htmlResponse('<title>ACME</title><p>事業内容</p><a href="/about">about</a>'),
    );
    const outcome = await fetcher.fetch(new URL("https://a.example/"));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.finalUrl).toBe("https://a.example/");
      expect(outcome.title).toBe("ACME");
      expect(outcome.text).toContain("事業内容");
      expect(outcome.links.map((link) => link.href)).toEqual(["https://a.example/about"]);
    }
  });

  it("text/plain はそのまま本文になりリンク抽出はしない", async () => {
    const { fetcher } = makeFetcher(
      () =>
        new Response("plain body http://x.example/", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    );
    const outcome = await fetcher.fetch(new URL("https://a.example/file.txt"));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.text).toBe("plain body http://x.example/");
      expect(outcome.links).toEqual([]);
      expect(outcome.title).toBeNull();
    }
  });
});

describe("PageFetcher: 4xx / 5xx（E10）", () => {
  it("404 は http_4xx でリトライしない", async () => {
    const { fetcher, stub } = makeFetcher(() => new Response("gone", { status: 404 }));
    const outcome = await fetcher.fetch(new URL("https://a.example/missing"));
    expectFailure(outcome, "http_4xx");
    expect(stub.callsTo("https://a.example/missing")).toHaveLength(1);
  });

  it("5xx は 1 回だけリトライし、再失敗で http_5xx", async () => {
    const { fetcher, stub } = makeFetcher(() => new Response("oops", { status: 500 }));
    const outcome = await fetcher.fetch(new URL("https://a.example/error"));
    expectFailure(outcome, "http_5xx");
    expect(stub.callsTo("https://a.example/error")).toHaveLength(2);
  });

  it("5xx → 2xx ならリトライで成功する", async () => {
    const { fetcher } = makeFetcher(({ callIndexForUrl }) =>
      callIndexForUrl === 0 ? new Response("oops", { status: 502 }) : htmlResponse("<p>ok</p>"),
    );
    const outcome = await fetcher.fetch(new URL("https://a.example/flaky"));
    expect(outcome.ok).toBe(true);
  });

  it("5xx リトライは 5 秒待機する（E10・フェイクタイマー）", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const { fetcher, stub } = makeFetcher(
        ({ callIndexForUrl }) =>
          callIndexForUrl === 0 ? new Response("oops", { status: 500 }) : htmlResponse("<p>ok</p>"),
        {}, // 既定設定（5xx 待機 5 秒）
      );
      const pending = fetcher.fetch(new URL("https://a.example/error"));
      await vi.runAllTimersAsync();
      const outcome = await pending;
      expect(outcome.ok).toBe(true);
      const calls = stub.callsTo("https://a.example/error");
      expect(calls).toHaveLength(2);
      // 5 秒待機 + ドメイン間隔（10 秒）の遅い方 = 10 秒以降に再試行
      expect((calls[1]?.timeMs ?? 0) - (calls[0]?.timeMs ?? 0)).toBeGreaterThanOrEqual(5_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PageFetcher: タイムアウト・接続エラー（E10）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("15 秒でタイムアウトし 1 回リトライ、再失敗で timeout", async () => {
    const { fetcher, stub } = makeFetcher(() => "hang", {});
    const pending = fetcher.fetch(new URL("https://slow.example/page"));
    await vi.runAllTimersAsync();
    const outcome = await pending;
    expectFailure(outcome, "timeout");
    const calls = stub.callsTo("https://slow.example/page");
    expect(calls).toHaveLength(2);
  });

  it("接続エラーは 1 回リトライ、再失敗で connection_error", async () => {
    const { fetcher, stub } = makeFetcher(() => {
      throw new TypeError("fetch failed");
    });
    const pending = fetcher.fetch(new URL("https://down.example/page"));
    await vi.runAllTimersAsync();
    const outcome = await pending;
    expectFailure(outcome, "connection_error");
    expect(stub.callsTo("https://down.example/page")).toHaveLength(2);
  });

  it("接続エラー → 成功ならリトライで回復する", async () => {
    const { fetcher } = makeFetcher(({ callIndexForUrl }) => {
      if (callIndexForUrl === 0) throw new TypeError("fetch failed");
      return htmlResponse("<p>ok</p>");
    });
    const pending = fetcher.fetch(new URL("https://flaky.example/page"));
    await vi.runAllTimersAsync();
    const outcome = await pending;
    expect(outcome.ok).toBe(true);
  });
});

describe("PageFetcher: 429（E10）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Retry-After（60 秒未満）でも最低 60 秒待って 1 回だけ再試行する", async () => {
    const { fetcher, stub } = makeFetcher(
      ({ callIndexForUrl }) =>
        callIndexForUrl === 0
          ? new Response("slow down", { status: 429, headers: { "retry-after": "5" } })
          : htmlResponse("<p>ok</p>"),
      {},
    );
    const pending = fetcher.fetch(new URL("https://busy.example/page"));
    await vi.runAllTimersAsync();
    const outcome = await pending;
    expect(outcome.ok).toBe(true);
    const calls = stub.callsTo("https://busy.example/page");
    expect(calls).toHaveLength(2);
    expect((calls[1]?.timeMs ?? 0) - (calls[0]?.timeMs ?? 0)).toBeGreaterThanOrEqual(60_000);
  });

  it("Retry-After が 60 秒より大きければそちらを待つ", async () => {
    const { fetcher, stub } = makeFetcher(
      ({ callIndexForUrl }) =>
        callIndexForUrl === 0
          ? new Response("slow down", { status: 429, headers: { "retry-after": "120" } })
          : htmlResponse("<p>ok</p>"),
      {},
    );
    const pending = fetcher.fetch(new URL("https://busy.example/page"));
    await vi.runAllTimersAsync();
    await pending;
    const calls = stub.callsTo("https://busy.example/page");
    expect((calls[1]?.timeMs ?? 0) - (calls[0]?.timeMs ?? 0)).toBeGreaterThanOrEqual(120_000);
  });

  it("429 後は同一ドメインの間隔が 2 倍（20 秒 + ジッター）に緩和される", async () => {
    const { fetcher, stub } = makeFetcher(
      ({ url, callIndexForUrl }) =>
        url.pathname === "/first" && callIndexForUrl === 0
          ? new Response("slow down", { status: 429 })
          : htmlResponse("<p>ok</p>"),
      {},
    );
    const first = fetcher.fetch(new URL("https://busy.example/first"));
    await vi.runAllTimersAsync();
    expect((await first).ok).toBe(true);

    const second = fetcher.fetch(new URL("https://busy.example/second"));
    await vi.runAllTimersAsync();
    expect((await second).ok).toBe(true);

    const retryAt = stub.callsTo("https://busy.example/first")[1]?.timeMs ?? 0;
    const secondAt = stub.callsTo("https://busy.example/second")[0]?.timeMs ?? 0;
    expect(secondAt - retryAt).toBeGreaterThanOrEqual(20_000);
  });

  it("同一ドメインで再度 429 なら打ち切り（domainAborted）", async () => {
    const { fetcher, stub, politeness } = makeFetcher(
      () => new Response("slow down", { status: 429 }),
      {},
    );
    const pending = fetcher.fetch(new URL("https://banned.example/page"));
    await vi.runAllTimersAsync();
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("http_4xx");
      expect(outcome.domainAborted).toBe(true);
    }
    expect(stub.callsTo("https://banned.example/page")).toHaveLength(2); // 初回 + 再試行のみ
    expect(politeness.isAborted("banned.example")).toBe(true);
  });

  it("打ち切り済みドメインへは以後アクセスしない", async () => {
    const { fetcher, stub, politeness } = makeFetcher(
      () => new Response("slow down", { status: 429 }),
      {},
    );
    const first = fetcher.fetch(new URL("https://banned.example/one"));
    await vi.runAllTimersAsync();
    await first;
    expect(politeness.isAborted("banned.example")).toBe(true);

    const before = stub.calls.length;
    const outcome = await fetcher.fetch(new URL("https://banned.example/two"));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.domainAborted).toBe(true);
    expect(stub.calls.length).toBe(before); // 追加のリクエストなし
  });
});

describe("parseRetryAfterMs", () => {
  it("秒数と HTTP-date の両形式を解釈し、不正値は null", () => {
    expect(parseRetryAfterMs("90", 0)).toBe(90_000);
    const now = Date.parse("2026-07-13T00:00:00Z");
    expect(parseRetryAfterMs("Mon, 13 Jul 2026 00:01:30 GMT", now)).toBe(90_000);
    expect(parseRetryAfterMs("Mon, 13 Jul 2026 00:00:00 GMT", now + 5_000)).toBe(0);
    expect(parseRetryAfterMs("garbage", 0)).toBeNull();
    expect(parseRetryAfterMs(null, 0)).toBeNull();
  });
});

describe("PageFetcher: リダイレクト（E10）", () => {
  it("最大 3 回まで追従して成功する", async () => {
    const { fetcher, stub } = makeFetcher(({ url }) => {
      const step = Number(url.pathname.replace("/step", "") || "0");
      if (step < 3) return redirectResponse(`/step${step + 1}`);
      return htmlResponse("<p>final</p>");
    });
    const outcome = await fetcher.fetch(new URL("https://a.example/step0"));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.finalUrl).toBe("https://a.example/step3");
    expect(stub.calls).toHaveLength(4);
  });

  it("4 回目のリダイレクトは redirect_error", async () => {
    const { fetcher } = makeFetcher(({ url }) => {
      const step = Number(url.pathname.replace("/step", "") || "0");
      if (step < 4) return redirectResponse(`/step${step + 1}`);
      return htmlResponse("<p>final</p>");
    });
    const outcome = await fetcher.fetch(new URL("https://a.example/step0"));
    expectFailure(outcome, "redirect_error");
  });

  it("リダイレクトループは redirect_error", async () => {
    const { fetcher } = makeFetcher(({ url }) =>
      redirectResponse(url.pathname === "/a" ? "/b" : "/a"),
    );
    const outcome = await fetcher.fetch(new URL("https://a.example/a"));
    expectFailure(outcome, "redirect_error");
  });

  it("内部アドレスへのリダイレクトは追わず redirect_error（SSRF 対策）", async () => {
    const { fetcher, stub } = makeFetcher(({ url }) => {
      if (url.host === "a.example") {
        return redirectResponse("http://169.254.169.254/latest/meta-data/");
      }
      return htmlResponse("<p>should not reach</p>");
    });
    const outcome = await fetcher.fetch(new URL("https://a.example/page"));
    expectFailure(outcome, "redirect_error");
    expect(stub.calls.every((call) => !call.url.includes("169.254.169.254"))).toBe(true);
  });

  it("Location ヘッダなし・不正スキームは redirect_error", async () => {
    const { fetcher } = makeFetcher(({ url }) => {
      if (url.pathname === "/no-location") return new Response(null, { status: 302 });
      return redirectResponse("javascript:alert(1)");
    });
    expectFailure(await fetcher.fetch(new URL("https://a.example/no-location")), "redirect_error");
    expectFailure(await fetcher.fetch(new URL("https://a.example/bad-scheme")), "redirect_error");
  });
});

describe("PageFetcher: サイズ上限・Content-Type（E12 / E10）", () => {
  it("Content-Length が上限超なら本文を読まず too_large", async () => {
    const { fetcher } = makeFetcher(
      () =>
        new Response("x", {
          status: 200,
          headers: { "content-type": "text/html", "content-length": "999999" },
        }),
      { ...FAST_CONFIG, maxBodyBytes: 128 },
    );
    expectFailure(await fetcher.fetch(new URL("https://a.example/big")), "too_large");
  });

  it("ストリーム読み取りで上限を超えたら too_large", async () => {
    const { fetcher } = makeFetcher(() => htmlResponse("a".repeat(256)), {
      ...FAST_CONFIG,
      maxBodyBytes: 128,
    });
    expectFailure(await fetcher.fetch(new URL("https://a.example/big")), "too_large");
  });

  it("テキスト系以外の Content-Type はスキップ（too_large 分類）", async () => {
    const { fetcher } = makeFetcher(
      () =>
        new Response("binary", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
    );
    expectFailure(await fetcher.fetch(new URL("https://a.example/doc")), "too_large");
  });
});

describe("PageFetcher: robots 連携（E10）", () => {
  it("robots が拒否したらリクエストせず robots_denied", async () => {
    const denyRobots: RobotsChecker = { isAllowed: () => Promise.resolve(false) };
    const { fetcher, stub } = makeFetcher(() => htmlResponse("<p>x</p>"), FAST_CONFIG, denyRobots);
    const outcome = await fetcher.fetch(new URL("https://a.example/private"));
    expectFailure(outcome, "robots_denied");
    expect(stub.calls).toHaveLength(0); // ページ本体へのアクセスなし
  });
});
