import { describe, expect, it } from "vitest";
import { classifyPageKind } from "../src/index.js";

describe("classifyPageKind: URL パスによる分類", () => {
  it.each([
    ["https://example.co.jp/company/", "corporate_site"],
    ["https://example.co.jp/about-us", "corporate_site"],
    ["https://example.co.jp/corporate/profile.html", "corporate_site"],
    ["https://example.co.jp/%E4%BC%9A%E7%A4%BE%E6%A6%82%E8%A6%81", "corporate_site"], // /会社概要
    ["https://example.co.jp/news/2026/07/new-office.html", "news"],
    ["https://example.co.jp/press-release/detail?id=1", "news"],
    ["https://example.co.jp/topics/1234", "news"],
    ["https://example.co.jp/recruit/", "recruit"],
    ["https://example.co.jp/careers/engineer", "recruit"],
    ["https://example.co.jp/saiyo", "recruit"],
    ["https://example.co.jp/blog/hello-world", "article"],
    ["https://example.co.jp/products/foo", "article"],
  ] as const)("%s → %s", (url, expected) => {
    expect(classifyPageKind(url, null)).toBe(expected);
  });

  it("深いセグメントを優先する（より具体的な区分を採用）", () => {
    expect(classifyPageKind("https://example.co.jp/company/news/2026", null)).toBe("news");
    expect(classifyPageKind("https://example.co.jp/recruit/about", null)).toBe("corporate_site");
    expect(classifyPageKind("https://example.co.jp/company/careers", null)).toBe("recruit");
  });

  it("トークンは完全一致（部分一致の誤ヒットをしない）", () => {
    expect(classifyPageKind("https://example.co.jp/roundabout", null)).toBe("article");
    expect(classifyPageKind("https://example.co.jp/newspaper-list", null)).toBe("article");
  });

  it("拡張子と区切り文字（- _ .）を処理してトークン化する", () => {
    expect(classifyPageKind("https://example.co.jp/news.html", null)).toBe("news");
    expect(classifyPageKind("https://example.co.jp/company_profile.php", null)).toBe(
      "corporate_site",
    );
  });
});

describe("classifyPageKind: ルートとタイトルのフォールバック", () => {
  it("トップページ（/ または /index.*）は corporate_site", () => {
    expect(classifyPageKind("https://example.co.jp/", null)).toBe("corporate_site");
    expect(classifyPageKind("https://example.co.jp/index.html", null)).toBe("corporate_site");
  });

  it("パスで決まらなければタイトルの部分一致で分類する", () => {
    expect(classifyPageKind("https://example.co.jp/page1", "会社概要 | 株式会社Example")).toBe(
      "corporate_site",
    );
    expect(classifyPageKind("https://example.co.jp/page2", "お知らせ一覧")).toBe("news");
    expect(classifyPageKind("https://example.co.jp/page3", "エンジニア採用サイト")).toBe("recruit");
    expect(classifyPageKind("https://example.co.jp/page4", "CAREERS at Example")).toBe("recruit");
  });

  it("タイトルが複数 kind に一致する場合はソース優先度の高い方を採用する", () => {
    expect(classifyPageKind("https://example.co.jp/page5", "会社概要・採用情報")).toBe(
      "corporate_site",
    );
  });

  it("どの規則にも該当しなければ article", () => {
    expect(classifyPageKind("https://example.co.jp/page6", "ただのページ")).toBe("article");
    expect(classifyPageKind("https://example.co.jp/page7", null)).toBe("article");
  });
});
