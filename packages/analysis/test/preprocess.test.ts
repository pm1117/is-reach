import { describe, expect, it } from "vitest";
import { prepareDossierSources } from "../src/index.js";
import { buildPage } from "./helpers.js";

describe("prepareDossierSources: 重複除去", () => {
  it("正規化後に同一 URL のページは 1 件にする（fragment は同一視・クエリは別ページ）", () => {
    const sources = prepareDossierSources([
      buildPage("https://example.co.jp/blog/a"),
      buildPage("https://example.co.jp/blog/a#section-2"),
      buildPage("https://example.co.jp/blog/a?page=2"),
    ]);
    expect(sources.map((s) => s.url)).toEqual([
      "https://example.co.jp/blog/a",
      "https://example.co.jp/blog/a?page=2",
    ]);
  });

  it("重複時は収集日時が最も新しいものを残す", () => {
    const sources = prepareDossierSources([
      buildPage("https://example.co.jp/blog/a", {
        fetchedAt: "2026-07-01T00:00:00Z",
        text: "古い本文",
      }),
      buildPage("https://example.co.jp/blog/a", {
        fetchedAt: "2026-07-10T00:00:00Z",
        text: "新しい本文",
      }),
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.text.text).toBe("新しい本文");
    expect(sources[0]?.fetchedAt).toBe("2026-07-10T00:00:00Z");
  });

  it("収集日時も同じ重複は入力順で先のものを残す（決定的）", () => {
    const sources = prepareDossierSources([
      buildPage("https://example.co.jp/blog/a", { text: "先の本文" }),
      buildPage("https://example.co.jp/blog/a", { text: "後の本文" }),
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.text.text).toBe("先の本文");
  });
});

describe("prepareDossierSources: kind 分類とソース優先度順", () => {
  it("会社概要 > ニュース > 採用 > その他公開記事 の順に整列する（design-detail 3.3 S5）", () => {
    const sources = prepareDossierSources([
      buildPage("https://example.co.jp/blog/entry-1"),
      buildPage("https://example.co.jp/recruit/"),
      buildPage("https://example.co.jp/news/2026"),
      buildPage("https://example.co.jp/company/"),
    ]);
    expect(sources.map((s) => s.kind)).toEqual(["corporate_site", "news", "recruit", "article"]);
    expect(sources.map((s) => s.url)).toEqual([
      "https://example.co.jp/company/",
      "https://example.co.jp/news/2026",
      "https://example.co.jp/recruit/",
      "https://example.co.jp/blog/entry-1",
    ]);
  });

  it("同一 kind 内は収集日時の新しい順 → URL 昇順", () => {
    const sources = prepareDossierSources([
      buildPage("https://example.co.jp/news/b", { fetchedAt: "2026-07-01T00:00:00Z" }),
      buildPage("https://example.co.jp/news/c", { fetchedAt: "2026-07-10T00:00:00Z" }),
      buildPage("https://example.co.jp/news/a", { fetchedAt: "2026-07-01T00:00:00Z" }),
    ]);
    expect(sources.map((s) => s.url)).toEqual([
      "https://example.co.jp/news/c",
      "https://example.co.jp/news/a",
      "https://example.co.jp/news/b",
    ]);
  });

  it("入力順を変えても同一の出力になる（決定性）", () => {
    const pages = [
      buildPage("https://example.co.jp/company/"),
      buildPage("https://example.co.jp/news/1"),
      buildPage("https://example.co.jp/blog/x"),
      buildPage("https://example.co.jp/careers/"),
    ];
    expect(prepareDossierSources(pages)).toEqual(prepareDossierSources([...pages].reverse()));
  });

  it("タイトルは kind 分類に使う（パスで決まらない場合のフォールバック）", () => {
    const sources = prepareDossierSources([
      buildPage("https://example.co.jp/page1", { title: "会社概要 | Example" }),
      buildPage("https://example.co.jp/page2", { title: null }),
    ]);
    expect(sources.map((s) => s.kind)).toEqual(["corporate_site", "article"]);
  });
});

describe("prepareDossierSources: 信頼境界と入力検証", () => {
  it("本文・タイトルは UntrustedText のまま保持する（出典 URL・収集日時付き）", () => {
    const page = buildPage("https://example.co.jp/company/", { title: "会社概要" });
    const sources = prepareDossierSources([page]);
    const source = sources[0];
    expect(source?.text.text).toBe(page.text.text);
    expect(source?.text.sourceUrl).toBe("https://example.co.jp/company/");
    expect(source?.text.collectedAt).toBe(page.fetchedAt);
    expect(source?.title?.text).toBe("会社概要");
  });

  it("出典 URL の無い本文（UntrustedText 契約違反）はスキーマ検証で拒否する", () => {
    const page = buildPage("https://example.co.jp/company/");
    const broken = {
      ...page,
      text: { text: "出典なし本文" } as unknown as typeof page.text,
    };
    expect(() => prepareDossierSources([broken])).toThrowError();
  });

  it("不正な URL・収集日時はスキーマ検証で拒否する", () => {
    const page = buildPage("https://example.co.jp/company/");
    expect(() =>
      prepareDossierSources([{ ...page, url: "ftp://example.co.jp/" as never }]),
    ).toThrowError();
    expect(() =>
      prepareDossierSources([{ ...page, fetchedAt: "2026/07/10" as never }]),
    ).toThrowError();
  });

  it("crawler の FetchedPage 相当の余剰プロパティ（requestedUrl 等）は無視して受け付ける", () => {
    const page = buildPage("https://example.co.jp/company/");
    const fetchedPageLike = { ...page, requestedUrl: "https://example.co.jp/redirect-from" };
    const sources = prepareDossierSources([fetchedPageLike]);
    expect(sources).toHaveLength(1);
    expect(sources[0]).not.toHaveProperty("requestedUrl");
  });
});
