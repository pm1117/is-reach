import { describe, expect, it } from "vitest";
import {
  decodeHtmlEntities,
  extractLinks,
  extractTextFromHtml,
  normalizePlainText,
} from "../src/html-to-text.js";

describe("extractTextFromHtml", () => {
  it("タイトルを抽出し script / style / nav 等の非本文要素を除去する", () => {
    const html = [
      "<html><head><title> ACME &amp; Co </title><style>body{color:red}</style></head>",
      "<body><nav><a href='/'>home</a></nav>",
      "<script>alert('x')</script>",
      "<h1>会社概要</h1><p>私たちは B2B SaaS を提供します。</p>",
      "<footer>copyright</footer></body></html>",
    ].join("");
    const result = extractTextFromHtml(html);
    expect(result.title).toBe("ACME & Co");
    expect(result.text).toContain("会社概要");
    expect(result.text).toContain("B2B SaaS");
    expect(result.text).not.toContain("alert");
    expect(result.text).not.toContain("color:red");
    expect(result.text).not.toContain("home");
    expect(result.text).not.toContain("copyright");
  });

  it("タイトルがなければ null を返す", () => {
    expect(extractTextFromHtml("<p>本文のみ</p>").title).toBeNull();
  });

  it("ブロック要素の境界は改行として保持される", () => {
    const { text } = extractTextFromHtml("<p>第一段落</p><p>第二段落</p>");
    expect(text).toBe("第一段落\n第二段落");
  });

  it("HTML コメントを除去する", () => {
    const { text } = extractTextFromHtml("<p>A<!-- 秘密のコメント -->B</p>");
    expect(text).not.toContain("秘密");
  });

  it("数値文字参照と名前付きエンティティを復号する", () => {
    const { text } = extractTextFromHtml("<p>&#x3042;&#12356; &lt;tag&gt; &nbsp;&amp;</p>");
    expect(text).toContain("あい");
    expect(text).toContain("<tag>");
    expect(text).toContain("&");
  });
});

describe("decodeHtmlEntities", () => {
  it("不正な数値参照・未知のエンティティは原文のまま残す", () => {
    expect(decodeHtmlEntities("&#xD800; &#x110000; &unknownent;")).toBe(
      "&#xD800; &#x110000; &unknownent;",
    );
  });
});

describe("normalizePlainText", () => {
  it("CRLF を LF に正規化し前後空白を除く", () => {
    expect(normalizePlainText("  a\r\nb\rc\n ")).toBe("a\nb\nc");
  });
});

describe("extractLinks", () => {
  const base = new URL("https://example.co.jp/news/index.html");

  it("相対 URL を解決し fragment を除去して重複排除する", () => {
    const html = [
      '<a href="/about">会社概要</a>',
      "<a href='item1.html#section'>記事1</a>",
      '<a href="item1.html">記事1再掲</a>',
      '<a href="https://example.co.jp/contact">連絡</a>',
    ].join("");
    const links = extractLinks(html, base).map((url) => url.href);
    expect(links).toEqual([
      "https://example.co.jp/about",
      "https://example.co.jp/news/item1.html",
      "https://example.co.jp/contact",
    ]);
  });

  it("http(s) 以外のスキームとフラグメントのみの参照を除外する", () => {
    const html = [
      '<a href="javascript:alert(1)">x</a>',
      '<a href="mailto:a@example.com">mail</a>',
      '<a href="#top">top</a>',
      '<a href="tel:0312345678">tel</a>',
    ].join("");
    expect(extractLinks(html, base)).toEqual([]);
  });

  it("href 内の &amp; を復号して解決する", () => {
    const html = '<a href="/search?a=1&amp;b=2">s</a>';
    expect(extractLinks(html, base).map((url) => url.href)).toEqual([
      "https://example.co.jp/search?a=1&b=2",
    ]);
  });

  it("外部ドメインのリンクも列挙する（絞り込みは呼び出し側の責務）", () => {
    const html = '<a href="https://other.example/">other</a>';
    expect(extractLinks(html, base)).toHaveLength(1);
  });
});
