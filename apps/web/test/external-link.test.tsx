// ExternalLink（ui-spec 7 章 3 — U8）: rel 必須・危険スキームのフォールバック・ホスト名表示
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExternalLink } from "@/components/ui/external-link";

describe("ExternalLink", () => {
  it("https URL をリンク化し rel='noopener noreferrer' + target='_blank' を必ず付ける", () => {
    render(<ExternalLink href="https://example.co.jp/news/1" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("href", "https://example.co.jp/news/1");
  });

  it("リンクテキストはホスト名 + パス（リンク先を隠さない）・title にフル URL を出す", () => {
    render(<ExternalLink href="https://example.co.jp/news/1" />);
    const link = screen.getByRole("link");
    expect(link).toHaveTextContent("example.co.jp/news/1");
    expect(link).toHaveAttribute("title", "https://example.co.jp/news/1");
  });

  it("長いパスは省略表示する", () => {
    const longPath = `/articles/${"a".repeat(50)}`;
    render(<ExternalLink href={`https://example.com${longPath}`} />);
    const link = screen.getByRole("link");
    expect(link.textContent).toContain("…");
    expect(link.textContent).not.toContain("a".repeat(50));
    // フル URL は title で確認できる
    expect(link).toHaveAttribute("title", `https://example.com${longPath}`);
  });

  it("ルートパスのみの URL はホスト名だけを表示する", () => {
    render(<ExternalLink href="https://example.com/" />);
    expect(screen.getByRole("link")).toHaveTextContent(/^example\.com/);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://example.com/file",
    "vbscript:msgbox(1)",
  ])("http(s) 以外のスキーム %s はリンク化せずプレーンテキストで表示する", (href) => {
    const { container } = render(<ExternalLink href={href} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain(href);
  });

  it("URL としてパース不能な文字列もプレーンテキストにフォールバックする", () => {
    const { container } = render(<ExternalLink href="not a url" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("not a url");
  });

  it("外部リンクであることをアイコン + スクリーンリーダー向けテキストで明示する", () => {
    const { container } = render(<ExternalLink href="https://example.com/x" />);
    expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByText("（外部リンク・新しいタブで開く）")).toBeInTheDocument();
  });
});
