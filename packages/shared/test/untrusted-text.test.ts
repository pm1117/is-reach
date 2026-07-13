import { describe, expect, it } from "vitest";
import { markUntrusted, untrustedTextSchema } from "../src/index.js";
import type { UntrustedText } from "../src/index.js";
import { HTTPS_URL, ISO_AT } from "./helpers.js";

describe("untrustedTextSchema（design-detail 3.3 / basic-design 8.2）", () => {
  it("出典 URL + 収集日時が揃っていれば受理する", () => {
    const parsed = untrustedTextSchema.parse({
      text: "外部サイトから収集した本文",
      sourceUrl: HTTPS_URL,
      collectedAt: ISO_AT,
    });
    expect(parsed.sourceUrl).toBe(HTTPS_URL);
  });

  it("出典 URL の欠落は型検査を通らない（出典なしデータの構造的拒否）", () => {
    expect(untrustedTextSchema.safeParse({ text: "本文", collectedAt: ISO_AT }).success).toBe(
      false,
    );
  });

  it("収集日時の欠落を拒否する", () => {
    expect(untrustedTextSchema.safeParse({ text: "本文", sourceUrl: HTTPS_URL }).success).toBe(
      false,
    );
  });

  it("https? 以外の出典 URL を拒否する", () => {
    for (const sourceUrl of [
      "javascript:alert(1)",
      "ftp://example.co.jp/file",
      "data:text/plain,hello",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(
        untrustedTextSchema.safeParse({ text: "本文", sourceUrl, collectedAt: ISO_AT }).success,
      ).toBe(false);
    }
    expect(
      untrustedTextSchema.safeParse({
        text: "本文",
        sourceUrl: "http://example.co.jp/",
        collectedAt: ISO_AT,
      }).success,
    ).toBe(true);
  });

  it("回帰: 大文字スキーム・先頭空白・タブ/引用符入り URL の挙動を固定する", () => {
    // 危険スキームは大文字・先頭空白付きでも拒否（URL パーサの正規化で https? にならない）
    for (const sourceUrl of ["JAVASCRIPT:alert(1)", " javascript:alert(1)"]) {
      expect(
        untrustedTextSchema.safeParse({ text: "本文", sourceUrl, collectedAt: ISO_AT }).success,
      ).toBe(false);
    }
    // URL パーサが黙って除去するタブや、属性値を壊す引用符を含む原文は拒否
    for (const sourceUrl of ["https://ex\tample.co.jp/", 'https://example.co.jp/pa"th']) {
      expect(
        untrustedTextSchema.safeParse({ text: "本文", sourceUrl, collectedAt: ISO_AT }).success,
      ).toBe(false);
    }
    // 大文字の https? スキーム・ホストは受理し、new URL().href に正規化して保持する
    const parsed = untrustedTextSchema.parse({
      text: "本文",
      sourceUrl: "HTTPS://EXAMPLE.co.jp/Path",
      collectedAt: ISO_AT,
    });
    expect(parsed.sourceUrl).toBe("https://example.co.jp/Path");
  });

  it("markUntrusted は検証済みの UntrustedText を返し、不正入力では例外を投げる", () => {
    const marked = markUntrusted({ text: "本文", sourceUrl: HTTPS_URL, collectedAt: ISO_AT });
    expect(marked.text).toBe("本文");
    expect(() => markUntrusted({ text: "本文", sourceUrl: "", collectedAt: ISO_AT })).toThrow();
  });

  it("brand 型: 構造が同じ素のオブジェクトは UntrustedText に代入できない（コンパイル時検査）", () => {
    // @ts-expect-error parse を通していない素のオブジェクトは brand を持たないため代入不可
    const invalid: UntrustedText = {
      text: "本文",
      sourceUrl: HTTPS_URL,
      collectedAt: ISO_AT,
    };
    // 実行時には brand は消えるため、値としては同一（型レベルのみの防御であることの確認）
    expect(invalid.text).toBe("本文");
  });
});
