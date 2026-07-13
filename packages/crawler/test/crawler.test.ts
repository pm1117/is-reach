// createCrawler 公開 API の統合テスト（fetch スタブ。実ネットワークには出ない）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { untrustedTextSchema } from "@is-reach/shared";
import { createCrawler, type CrawlProgress } from "../src/crawler.js";
import {
  FAST_CONFIG,
  createStubFetch,
  htmlResponse,
  notFound,
  redirectResponse,
  robotsOk,
  withRobots404,
  type StubFetch,
} from "./helpers.js";

function page(links: string[], body = "本文"): Response {
  const anchors = links.map((href) => `<a href="${href}">link</a>`).join("");
  return htmlResponse(`<title>t</title><p>${body}</p>${anchors}`);
}

describe("deepDive: 収集と同一ドメイン限定", () => {
  it("開始 URL からサイト内リンクを辿り、結果を UntrustedText で返す", async () => {
    const stub = createStubFetch(
      withRobots404(({ url }) => {
        if (url.pathname === "/") return page(["/about", "https://other.example/x", "mailto:a@b"]);
        if (url.pathname === "/about") return page([]);
        return notFound();
      }),
    );
    const crawler = createCrawler(FAST_CONFIG, { fetchImpl: stub.fetchImpl });
    const result = await crawler.deepDive({ startUrl: "https://acme.example/" });

    expect(result.pages.map((p) => p.url)).toEqual([
      "https://acme.example/",
      "https://acme.example/about",
    ]);
    expect(result.partialFailures).toEqual([]);
    expect(result.abortedHosts).toEqual([]);
    // 外部ドメインへはアクセスしていない
    expect(stub.calls.every((call) => call.url.startsWith("https://acme.example/"))).toBe(true);
    // 収集本文は shared の UntrustedText（出典 URL・収集日時必須）を満たす
    const first = result.pages[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(() => untrustedTextSchema.parse(first.text)).not.toThrow();
      expect(first.text.sourceUrl).toBe("https://acme.example/");
      expect(first.title?.text).toBe("t");
    }
  });

  it("スキームなしの企業ドメイン入力は https として解釈する", async () => {
    const stub = createStubFetch(withRobots404(() => page([])));
    const crawler = createCrawler(FAST_CONFIG, { fetchImpl: stub.fetchImpl });
    const result = await crawler.deepDive({ startUrl: "acme.example" });
    expect(result.pages[0]?.url).toBe("https://acme.example/");
  });

  it("ページ上限（deepDiveMaxPages）で打ち切る", async () => {
    const stub = createStubFetch(
      withRobots404(({ url }) => {
        // 各ページが多数のリンクを持つ
        const links = Array.from({ length: 10 }, (_, i) => `/p${i}?from=${url.pathname}`);
        return page(links);
      }),
    );
    const crawler = createCrawler(
      { ...FAST_CONFIG, deepDiveMaxPages: 3 },
      { fetchImpl: stub.fetchImpl },
    );
    const progress: CrawlProgress[] = [];
    const result = await crawler.deepDive({
      startUrl: "https://acme.example/",
      onProgress: (p) => progress.push(p),
    });
    expect(result.pages).toHaveLength(3);
    // 進捗は plannedPages 上限 3 で報告される
    expect(progress.at(-1)).toEqual({ fetchedPages: 3, plannedPages: 3 });
    expect(progress.every((p) => (p.plannedPages ?? 0) <= 3)).toBe(true);
    // robots.txt + 3 ページのみアクセス
    expect(stub.calls.filter((c) => !c.url.endsWith("/robots.txt"))).toHaveLength(3);
  });

  it("取得失敗ページは partialFailures に FetchErrorKind 付きで記録し継続する", async () => {
    const stub = createStubFetch(
      withRobots404(({ url }) => {
        if (url.pathname === "/") return page(["/broken", "/ok"]);
        if (url.pathname === "/broken") return notFound();
        return page([]);
      }),
    );
    const crawler = createCrawler(FAST_CONFIG, { fetchImpl: stub.fetchImpl });
    const result = await crawler.deepDive({ startUrl: "https://acme.example/" });
    expect(result.pages.map((p) => p.url)).toEqual([
      "https://acme.example/",
      "https://acme.example/ok",
    ]);
    expect(result.partialFailures).toEqual([
      { url: "https://acme.example/broken", reason: "http_4xx" },
    ]);
  });

  it("www リダイレクト後は最終ホストのサイト内を辿る", async () => {
    const stub = createStubFetch(
      withRobots404(({ url }) => {
        if (url.host === "acme.example") {
          return redirectResponse("https://www.acme.example/");
        }
        if (url.pathname === "/") return page(["/about"]);
        return page([]);
      }),
    );
    const crawler = createCrawler(FAST_CONFIG, { fetchImpl: stub.fetchImpl });
    const result = await crawler.deepDive({ startUrl: "https://acme.example/" });
    expect(result.pages.map((p) => p.url)).toEqual([
      "https://www.acme.example/",
      "https://www.acme.example/about",
    ]);
  });

  it("不正な startUrl は ZodError（外部入力のスキーマ検証）", async () => {
    const crawler = createCrawler(FAST_CONFIG, {
      fetchImpl: createStubFetch(() => notFound()).fetchImpl,
    });
    await expect(crawler.deepDive({ startUrl: "" })).rejects.toThrow(ZodError);
    await expect(crawler.deepDive({ startUrl: "ftp://a.example/" })).rejects.toThrow(ZodError);
    // 内部アドレスは開始 URL に指定できない（SSRF 対策）
    await expect(crawler.deepDive({ startUrl: "http://localhost:3000/" })).rejects.toThrow(
      ZodError,
    );
    await expect(crawler.deepDive({ startUrl: "http://169.254.169.254/" })).rejects.toThrow(
      ZodError,
    );
  });

  it("内部アドレスへのリンクは収集対象にしない（SSRF 対策）", async () => {
    const stub = createStubFetch(
      withRobots404(({ url }) => {
        if (url.pathname === "/") {
          return page(["http://169.254.169.254/latest/meta-data/", "/ok"]);
        }
        return page([]);
      }),
    );
    const crawler = createCrawler(FAST_CONFIG, { fetchImpl: stub.fetchImpl });
    const result = await crawler.deepDive({ startUrl: "https://acme.example/" });
    expect(result.pages.map((p) => p.url)).toEqual([
      "https://acme.example/",
      "https://acme.example/ok",
    ]);
    expect(stub.calls.every((call) => !call.url.includes("169.254.169.254"))).toBe(true);
  });
});

describe("deepDive: robots.txt 遵守（E10）", () => {
  it("robots 拒否のパスは取得せず robots_denied、以後もリトライしない", async () => {
    const stub = createStubFetch(({ url }) => {
      if (url.pathname === "/robots.txt") {
        return robotsOk(["User-agent: *", "Disallow: /private"].join("\n"));
      }
      if (url.pathname === "/") return page(["/private/secret", "/open"]);
      return page([]);
    });
    const crawler = createCrawler(FAST_CONFIG, { fetchImpl: stub.fetchImpl });
    const result = await crawler.deepDive({ startUrl: "https://acme.example/" });
    expect(result.pages.map((p) => p.url)).toEqual([
      "https://acme.example/",
      "https://acme.example/open",
    ]);
    expect(result.partialFailures).toEqual([
      { url: "https://acme.example/private/secret", reason: "robots_denied" },
    ]);
    // 拒否されたページ本体へのリクエストは 0 回・robots.txt は 1 回だけ
    expect(stub.callsTo("https://acme.example/private/secret")).toHaveLength(0);
    expect(stub.callsTo("https://acme.example/robots.txt")).toHaveLength(1);
  });

  it("robots.txt が 5xx なら保守的に 1 ページも取得しない", async () => {
    const stub = createStubFetch(({ url }) => {
      if (url.pathname === "/robots.txt") return new Response("err", { status: 500 });
      return page([]);
    });
    const crawler = createCrawler(FAST_CONFIG, { fetchImpl: stub.fetchImpl });
    const result = await crawler.deepDive({ startUrl: "https://acme.example/" });
    expect(result.pages).toEqual([]);
    expect(result.partialFailures).toEqual([
      { url: "https://acme.example/", reason: "robots_denied" },
    ]);
    expect(stub.callsTo("https://acme.example/")).toHaveLength(0);
  });

  it("robots.txt が 404 なら許可として取得する", async () => {
    const stub = createStubFetch(withRobots404(() => page([])));
    const crawler = createCrawler(FAST_CONFIG, { fetchImpl: stub.fetchImpl });
    const result = await crawler.deepDive({ startUrl: "https://acme.example/" });
    expect(result.pages).toHaveLength(1);
  });
});

describe("deepDive: 429 打ち切り（E10）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("再 429 でドメインの残りページを打ち切り、abortedHosts に記録する", async () => {
    const stub = createStubFetch(({ url }) => {
      if (url.pathname === "/robots.txt") return notFound();
      if (url.pathname === "/") return page(["/a", "/b", "/c"]);
      return new Response("slow down", { status: 429 });
    });
    // タイミング検証を含むため既定値（60 秒待機・間隔 2 倍）を使う
    const crawler = createCrawler(undefined, {
      fetchImpl: stub.fetchImpl,
      random: () => 0,
    });
    const pending = crawler.deepDive({ startUrl: "https://acme.example/" });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.pages).toHaveLength(1); // トップページのみ
    // /a が 429 →（60 秒待機して）再試行 → 再 429 → ドメイン打ち切り
    expect(stub.callsTo("https://acme.example/a")).toHaveLength(2);
    // /b /c は試行されない（partialFailures にも入らない = 未試行）
    expect(stub.callsTo("https://acme.example/b")).toHaveLength(0);
    expect(stub.callsTo("https://acme.example/c")).toHaveLength(0);
    expect(result.partialFailures).toEqual([{ url: "https://acme.example/a", reason: "http_4xx" }]);
    expect(result.abortedHosts).toEqual(["acme.example"]);
  });
});

describe("collectSignals: シグナル収集フェッチ", () => {
  it("各ソースを上限ページ数まで収集し、ソース単位で結果を返す（E12）", async () => {
    const stub = createStubFetch(
      withRobots404(({ url }) => {
        if (url.pathname === "/") {
          return page(["/1", "/2", "/3", "/4", "/5", "/6"]);
        }
        return page([]);
      }),
    );
    const progress: CrawlProgress[] = [];
    const crawler = createCrawler(
      { ...FAST_CONFIG, signalSourceMaxPages: 2 },
      { fetchImpl: stub.fetchImpl },
    );
    const result = await crawler.collectSignals({
      sourceUrls: ["https://news.example/", "https://blog.example/"],
      onProgress: (p) => progress.push(p),
    });

    expect(result.sources).toHaveLength(2);
    for (const source of result.sources) {
      expect(source.pages).toHaveLength(2); // 上限 2 ページ
      expect(source.partialFailures).toEqual([]);
    }
    expect(result.sources.map((s) => s.sourceUrl)).toEqual([
      "https://news.example/",
      "https://blog.example/",
    ]);
    // 進捗は全ソース合算で報告される
    expect(progress.at(-1)).toEqual({ fetchedPages: 4, plannedPages: 4 });
  });

  it("ソース単位の失敗は他ソースの収集を止めない", async () => {
    const stub = createStubFetch(
      withRobots404(({ url }) => {
        if (url.host === "down.example") throw new TypeError("fetch failed");
        return page([]);
      }),
    );
    const crawler = createCrawler(FAST_CONFIG, { fetchImpl: stub.fetchImpl });
    const result = await crawler.collectSignals({
      sourceUrls: ["https://down.example/feed", "https://ok.example/feed"],
    });
    const down = result.sources.find((s) => s.sourceUrl === "https://down.example/feed");
    const ok = result.sources.find((s) => s.sourceUrl === "https://ok.example/feed");
    expect(down?.pages).toEqual([]);
    expect(down?.partialFailures).toEqual([
      { url: "https://down.example/feed", reason: "connection_error" },
    ]);
    expect(ok?.pages).toHaveLength(1);
  });

  it("空のソースリストは ZodError", async () => {
    const crawler = createCrawler(FAST_CONFIG, {
      fetchImpl: createStubFetch(() => notFound()).fetchImpl,
    });
    await expect(crawler.collectSignals({ sourceUrls: [] })).rejects.toThrow(ZodError);
  });

  it("全体同時 5 接続の上限が保たれる（別ドメイン並列 — E12）", async () => {
    const stub = createStubFetch(async ({ url }) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      if (url.pathname === "/robots.txt") return notFound();
      return page([]);
    });
    const crawler = createCrawler(FAST_CONFIG, { fetchImpl: stub.fetchImpl });
    const sourceUrls = Array.from({ length: 8 }, (_, i) => `https://s${i}.example/`);
    await crawler.collectSignals({ sourceUrls });
    expect(stub.maxInFlight()).toBeLessThanOrEqual(5);
  });
});

function stubForSerialCheck(): StubFetch {
  return createStubFetch(async ({ url }) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (url.pathname === "/robots.txt") return notFound();
    return page(["/a", "/b"]);
  });
}

describe("同時実行制御の統合確認", () => {
  it("同一ドメインへのリクエストは重ならない（直列 1 接続 — E12）", async () => {
    const stub = stubForSerialCheck();
    const crawler = createCrawler(FAST_CONFIG, { fetchImpl: stub.fetchImpl });
    await crawler.deepDive({ startUrl: "https://serial.example/" });
    // 全アクセスが同一ドメインなので in-flight は常に 1 以下
    expect(stub.maxInFlight()).toBe(1);
  });
});
