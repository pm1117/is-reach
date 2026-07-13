import { describe, expect, it } from "vitest";
import { resolveCrawlerConfig, buildUserAgent } from "../src/config.js";
import { PolitenessController } from "../src/politeness.js";
import {
  MAX_ROBOTS_TXT_CHARS,
  RobotsCache,
  isPathAllowedByGroups,
  matchesRobotsPattern,
  parseRobotsTxt,
} from "../src/robots.js";
import { FAST_CONFIG, createStubFetch, notFound, robotsOk, type StubHandler } from "./helpers.js";

const TOKEN = "is-reach-bot";

function allowed(robotsTxt: string, path: string): boolean {
  return isPathAllowedByGroups(parseRobotsTxt(robotsTxt), TOKEN, path);
}

describe("parseRobotsTxt / isPathAllowedByGroups", () => {
  it("ワイルドカードグループの Disallow が適用される", () => {
    const txt = ["User-agent: *", "Disallow: /private"].join("\n");
    expect(allowed(txt, "/private")).toBe(false);
    expect(allowed(txt, "/private/page")).toBe(false);
    expect(allowed(txt, "/public")).toBe(true);
  });

  it("固有 User-agent グループがワイルドカードより優先される", () => {
    const txt = [
      "User-agent: *",
      "Disallow: /",
      "",
      "User-agent: is-reach-bot",
      "Disallow: /admin",
    ].join("\n");
    expect(allowed(txt, "/anything")).toBe(true);
    expect(allowed(txt, "/admin/settings")).toBe(false);
  });

  it("User-agent は製品トークンの前方一致（大文字小文字無視）で照合される", () => {
    const txt = ["User-agent: IS-REACH", "Disallow: /"].join("\n");
    expect(allowed(txt, "/")).toBe(false);
  });

  it("最長一致のルールが勝つ（Disallow /a より Allow /a/b が優先）", () => {
    const txt = ["User-agent: *", "Disallow: /a", "Allow: /a/b"].join("\n");
    expect(allowed(txt, "/a/x")).toBe(false);
    expect(allowed(txt, "/a/b/c")).toBe(true);
  });

  it("同長のルールは Allow が優先される", () => {
    const txt = ["User-agent: *", "Disallow: /ab", "Allow: /ab"].join("\n");
    expect(allowed(txt, "/ab")).toBe(true);
  });

  it("空の Disallow はすべて許可", () => {
    const txt = ["User-agent: *", "Disallow:"].join("\n");
    expect(allowed(txt, "/any")).toBe(true);
  });

  it("`*` ワイルドカードと `$` アンカーを解釈する", () => {
    const txt = ["User-agent: *", "Disallow: /*.pdf$"].join("\n");
    expect(allowed(txt, "/docs/file.pdf")).toBe(false);
    expect(allowed(txt, "/docs/file.pdfx")).toBe(true);
  });

  it("コメントと連続 User-agent 行のグループ化を扱える", () => {
    const txt = [
      "# comment",
      "User-agent: foo",
      "User-agent: is-reach-bot",
      "Disallow: /x # trailing comment",
    ].join("\n");
    expect(allowed(txt, "/x/y")).toBe(false);
  });
});

describe("matchesRobotsPattern", () => {
  it("正規表現メタ文字を特別扱いしない（リテラル一致）", () => {
    expect(matchesRobotsPattern("/a+b", "/a+b/c")).toBe(true);
    expect(matchesRobotsPattern("/a+b", "/aab")).toBe(false);
  });

  it("複数ワイルドカードの組み合わせを正しく判定する", () => {
    expect(matchesRobotsPattern("/a*/b*/c", "/a1/b2/c3")).toBe(true);
    expect(matchesRobotsPattern("/a*/b*/c", "/a1/c3")).toBe(false);
    expect(matchesRobotsPattern("/*x*y$", "/111x222y")).toBe(true);
    expect(matchesRobotsPattern("/*x*y$", "/111x222yz")).toBe(false);
    expect(matchesRobotsPattern("*", "/anything")).toBe(true);
  });

  it("悪意あるパターンでも破滅的バックトラッキングしない（ReDoS 回帰）", () => {
    const maliciousPattern = `/${"*a".repeat(30)}$`;
    const nonMatchingPath = `/${"a".repeat(2000)}b`;
    const startedAt = performance.now();
    expect(matchesRobotsPattern(maliciousPattern, nonMatchingPath)).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(200); // 線形マッチなら実測 1ms 未満
  });
});

function makeRobotsCache(handler: StubHandler) {
  const config = resolveCrawlerConfig(FAST_CONFIG);
  const stub = createStubFetch(handler);
  const politeness = new PolitenessController(config, {
    now: () => Date.now(),
    random: () => 0,
  });
  const cache = new RobotsCache({
    rawGetOptions: {
      fetchImpl: stub.fetchImpl,
      userAgent: buildUserAgent(config),
      timeoutMs: config.pageTimeoutMs,
      maxBodyBytes: config.maxBodyBytes,
    },
    maxRedirects: config.maxRedirects,
    politeness,
  });
  return { cache, stub };
}

describe("RobotsCache", () => {
  it("robots.txt が 404 なら許可とみなす（E10）", async () => {
    const { cache } = makeRobotsCache(() => notFound());
    await expect(cache.isAllowed(new URL("https://a.example/page"))).resolves.toBe(true);
  });

  it("robots.txt が 5xx なら保守的にクロールしない（E10）", async () => {
    const { cache } = makeRobotsCache(() => new Response("oops", { status: 503 }));
    await expect(cache.isAllowed(new URL("https://a.example/page"))).resolves.toBe(false);
  });

  it("robots.txt がタイムアウトなら保守的にクロールしない（E10）", async () => {
    const config = resolveCrawlerConfig({ ...FAST_CONFIG, pageTimeoutMs: 30 });
    const stub = createStubFetch(() => "hang");
    const politeness = new PolitenessController(config, {
      now: () => Date.now(),
      random: () => 0,
    });
    const cache = new RobotsCache({
      rawGetOptions: {
        fetchImpl: stub.fetchImpl,
        userAgent: buildUserAgent(config),
        timeoutMs: config.pageTimeoutMs,
        maxBodyBytes: config.maxBodyBytes,
      },
      maxRedirects: config.maxRedirects,
      politeness,
    });
    await expect(cache.isAllowed(new URL("https://slow.example/page"))).resolves.toBe(false);
  });

  it("接続エラーなら保守的にクロールしない（E10）", async () => {
    const { cache } = makeRobotsCache(() => {
      throw new TypeError("fetch failed");
    });
    await expect(cache.isAllowed(new URL("https://down.example/page"))).resolves.toBe(false);
  });

  it("取得結果はドメイン（オリジン）単位でキャッシュされる", async () => {
    const { cache, stub } = makeRobotsCache(() =>
      robotsOk(["User-agent: *", "Disallow: /deny"].join("\n")),
    );
    await expect(cache.isAllowed(new URL("https://a.example/one"))).resolves.toBe(true);
    await expect(cache.isAllowed(new URL("https://a.example/deny/x"))).resolves.toBe(false);
    await expect(cache.isAllowed(new URL("https://a.example/two"))).resolves.toBe(true);
    expect(stub.callsTo("https://a.example/robots.txt")).toHaveLength(1);
  });

  it("robots.txt のリダイレクトを追従する", async () => {
    const { cache, stub } = makeRobotsCache(({ url }) => {
      if (url.href === "http://a.example/robots.txt") {
        return new Response(null, {
          status: 301,
          headers: { location: "https://a.example/robots.txt" },
        });
      }
      return robotsOk(["User-agent: *", "Disallow: /deny"].join("\n"));
    });
    await expect(cache.isAllowed(new URL("http://a.example/deny/x"))).resolves.toBe(false);
    expect(stub.calls).toHaveLength(2);
  });

  it("robots.txt が内部アドレスへリダイレクトしたら追わず保守的に拒否する（SSRF 対策）", async () => {
    const { cache, stub } = makeRobotsCache(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/robots.txt" },
        }),
    );
    await expect(cache.isAllowed(new URL("https://a.example/page"))).resolves.toBe(false);
    expect(stub.calls.every((call) => !call.url.includes("169.254.169.254"))).toBe(true);
  });

  it("robots.txt は先頭 MAX_ROBOTS_TXT_CHARS だけ解釈する（超過分のルールは無視）", async () => {
    const padding = "#".repeat(MAX_ROBOTS_TXT_CHARS);
    const body = [
      "User-agent: *",
      "Disallow: /early",
      padding, // ここまでで上限超過
      "User-agent: *",
      "Disallow: /late",
    ].join("\n");
    const { cache } = makeRobotsCache(() => robotsOk(body));
    await expect(cache.isAllowed(new URL("https://a.example/early/x"))).resolves.toBe(false);
    await expect(cache.isAllowed(new URL("https://a.example/late/x"))).resolves.toBe(true);
  });

  it("robots.txt のリダイレクトループは保守的に拒否する", async () => {
    const { cache } = makeRobotsCache(({ url }) => {
      const other =
        url.protocol === "https:" ? "http://a.example/robots.txt" : "https://a.example/robots.txt";
      return new Response(null, { status: 302, headers: { location: other } });
    });
    await expect(cache.isAllowed(new URL("https://a.example/page"))).resolves.toBe(false);
  });
});
