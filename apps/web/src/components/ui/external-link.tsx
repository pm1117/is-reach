// 外部リンクの表示専用コンポーネント（ui-spec 7 章 3 — 決定 U8。レビュー必須観点）。
// 出典 URL はスクレイピング由来 = 信頼境界外。素の <a> の使用は lint で禁止し、
// 外部 URL へのリンクは必ずこのコンポーネントに集約する。
// - target="_blank" + rel="noopener noreferrer" を必須とする
// - 外部リンク明示アイコン（↗）+ リンクテキストはホスト名 + パス（省略表示）で偽装を防ぐ
// - ホバーでフル URL をツールチップ表示（title）
// - http(s) 以外のスキーム（javascript: 等）はリンク化せずプレーンテキストにフォールバック
import { cx } from "@/lib/cx";

/** リンクテキストに表示するパス部分の最大文字数（省略表示の仮置き値） */
const MAX_DISPLAY_PATH_LENGTH = 24;

export interface ExternalLinkProps {
  /** 外部由来の URL 文字列（未検証のまま渡してよい。ここで検証する） */
  href: string;
  className?: string;
}

export function ExternalLink({ href, className }: ExternalLinkProps) {
  const url = parseHttpUrl(href);

  if (url === null) {
    // 危険・不明スキームや URL として不正な文字列はリンク化しない（プレーンテキスト表示）
    return <span className={cx("break-all text-neutral-600", className)}>{href}</span>;
  }

  return (
    <a
      href={url.href}
      target="_blank"
      rel="noopener noreferrer"
      title={url.href}
      className={cx(
        "inline-flex max-w-full items-baseline gap-0.5 break-all text-primary hover:text-primary-hover hover:underline",
        className,
      )}
    >
      {formatLinkText(url)}
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        className="size-3 shrink-0 self-center"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4.5 2.5h5v5" />
        <path d="M9.5 2.5 3 9" />
      </svg>
      <span className="sr-only">（外部リンク・新しいタブで開く）</span>
    </a>
  );
}

/** http(s) の URL のみ受理する。それ以外（javascript: / data: 等・パース不能）は null */
function parseHttpUrl(href: string): URL | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url : null;
}

/** リンク先を隠さない表示テキスト: ホスト名 + パス（長いパスは省略表示） */
function formatLinkText(url: URL): string {
  const path = `${url.pathname}${url.search}`;
  const displayPath = path === "/" ? "" : path;
  const truncated =
    displayPath.length > MAX_DISPLAY_PATH_LENGTH
      ? `${displayPath.slice(0, MAX_DISPLAY_PATH_LENGTH)}…`
      : displayPath;
  return `${url.host}${truncated}`;
}
