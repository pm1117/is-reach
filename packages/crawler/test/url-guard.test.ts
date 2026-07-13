import { describe, expect, it } from "vitest";
import { MAX_CRAWL_URL_LENGTH, isForbiddenCrawlHost, isSafeCrawlUrl } from "../src/url-guard.js";

describe("isForbiddenCrawlHost", () => {
  it("localhost と *.localhost を遮断する（FQDN の末尾ドット表記も含む）", () => {
    expect(isForbiddenCrawlHost("localhost")).toBe(true);
    expect(isForbiddenCrawlHost("app.localhost")).toBe(true);
    expect(isForbiddenCrawlHost("localhost.")).toBe(true);
    expect(isForbiddenCrawlHost("app.localhost.")).toBe(true);
  });

  it("クラウドメタデータのホスト名と .internal TLD を遮断する", () => {
    expect(isForbiddenCrawlHost("metadata.google.internal")).toBe(true);
    expect(isForbiddenCrawlHost("METADATA.GOOGLE.INTERNAL")).toBe(true);
    expect(isForbiddenCrawlHost("metadata.google.internal.")).toBe(true);
    expect(isForbiddenCrawlHost("db.corp.internal")).toBe(true);
    // 公開ドメインの部分一致では誤遮断しない
    expect(isForbiddenCrawlHost("internal.example.co.jp")).toBe(false);
  });

  it("プライベート・予約レンジの IPv4 リテラルを遮断する", () => {
    for (const host of [
      "127.0.0.1",
      "10.0.0.5",
      "169.254.169.254", // クラウドメタデータ
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "192.0.2.1", // TEST-NET-1
      "198.51.100.1", // TEST-NET-2
      "203.0.113.1", // TEST-NET-3
    ]) {
      expect(isForbiddenCrawlHost(host), host).toBe(true);
    }
  });

  it("パブリック IPv4 と通常のドメインは許可する", () => {
    expect(isForbiddenCrawlHost("8.8.8.8")).toBe(false);
    expect(isForbiddenCrawlHost("172.32.0.1")).toBe(false); // 172.16/12 の外
    expect(isForbiddenCrawlHost("203.1.0.1")).toBe(false); // TEST-NET-3（/24）の外
    expect(isForbiddenCrawlHost("198.51.99.1")).toBe(false); // TEST-NET-2（/24）の外
    expect(isForbiddenCrawlHost("example.co.jp")).toBe(false);
  });

  it("IPv6 リテラルは保守的にすべて遮断する", () => {
    expect(isForbiddenCrawlHost("::1")).toBe(true);
    expect(isForbiddenCrawlHost("fe80::1")).toBe(true);
    expect(isForbiddenCrawlHost("2001:db8::1")).toBe(true);
  });
});

describe("isSafeCrawlUrl", () => {
  it("http(s) の公開ホストのみ許可する", () => {
    expect(isSafeCrawlUrl("https://example.co.jp/about")).toBe(true);
    expect(isSafeCrawlUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSafeCrawlUrl("http://localhost:3000/")).toBe(false);
    expect(isSafeCrawlUrl("http://[::1]/")).toBe(false);
    expect(isSafeCrawlUrl("ftp://example.com/")).toBe(false);
    expect(isSafeCrawlUrl("javascript:alert(1)")).toBe(false);
  });

  it("URL 長の上限を超えるものは拒否する", () => {
    const longUrl = `https://example.com/${"a".repeat(MAX_CRAWL_URL_LENGTH)}`;
    expect(isSafeCrawlUrl(longUrl)).toBe(false);
  });
});
