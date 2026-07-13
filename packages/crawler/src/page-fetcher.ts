// 1 ページ分の取得: robots 評価 → 節度制御下の GET → HTTP エラー分類（design-detail 4.2 — 決定 E10）。
// 分類ごとの扱い:
//   2xx: 成功（非テキスト Content-Type / 2MB 超は too_large としてスキップ）
//   3xx: 追従は最大 3 回。ループ・超過・不正 Location は redirect_error（リトライなし）
//   4xx: http_4xx（リトライなし）
//   429: Retry-After と 60 秒の大きい方を待って 1 回だけ再試行 + ドメイン間隔 2 倍。
//        同一ドメインで再度 429 ならドメイン打ち切り（domainAborted）
//   5xx: http_5xx（5 秒待機で 1 回リトライ）
//   タイムアウト（15 秒）: timeout（1 回リトライ）/ DNS・接続: connection_error（1 回リトライ）
import type { FetchErrorKind } from "@is-reach/shared";
import { buildUserAgent, type CrawlerConfig } from "./config.js";
import { extractLinks, extractTextFromHtml, normalizePlainText } from "./html-to-text.js";
import { sleep } from "./internal/async.js";
import { rawGet, type RawGetOptions } from "./internal/http.js";
import type { PolitenessController } from "./politeness.js";
import type { RobotsChecker } from "./robots.js";
import { isSafeCrawlUrl } from "./url-guard.js";

export type PageFetchOutcome =
  | {
      ok: true;
      /** リダイレクト解決後の最終 URL（出典 URL として使う） */
      finalUrl: string;
      /** 取得時刻（ISO 8601） */
      fetchedAt: string;
      title: string | null;
      text: string;
      /** ページ内リンク（絶対 URL）。同一ドメイン判定は呼び出し側で行う */
      links: URL[];
    }
  | {
      ok: false;
      reason: FetchErrorKind;
      /** 429 再発によりこのドメインが打ち切られた（呼び出し側は残りページの投入をやめる） */
      domainAborted: boolean;
    };

export interface PageFetcherDeps {
  fetchImpl: typeof fetch;
  now: () => number;
}

/** HTML として本文抽出・リンク抽出を行う Content-Type */
function isHtmlContentType(mime: string): boolean {
  return mime === "" || mime === "text/html" || mime === "application/xhtml+xml";
}

/** プレーンテキスト化の対象とするテキスト系 Content-Type（それ以外はスキップ） */
const TEXTUAL_MIME_TYPES = new Set([
  "application/xhtml+xml",
  "application/xml",
  "application/rss+xml",
  "application/atom+xml",
  "application/json",
  "application/ld+json",
]);

function parseMime(header: string | null): string {
  if (header === null) return "";
  return (header.split(";")[0] ?? "").trim().toLowerCase();
}

function isTextualContentType(mime: string): boolean {
  // Content-Type ヘッダなしは HTML とみなして試みる（実サイトでの欠落に寛容にする）
  return mime === "" || mime.startsWith("text/") || TEXTUAL_MIME_TYPES.has(mime);
}

/** Retry-After ヘッダ（秒数 or HTTP-date）を待機 ms に変換する。解釈不能なら null */
export function parseRetryAfterMs(header: string | null, nowMs: number): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - nowMs);
}

function failure(reason: FetchErrorKind): PageFetchOutcome {
  return { ok: false, reason, domainAborted: false };
}

export class PageFetcher {
  private readonly rawGetOptions: RawGetOptions;

  constructor(
    private readonly config: CrawlerConfig,
    private readonly deps: PageFetcherDeps,
    private readonly politeness: PolitenessController,
    private readonly robots: RobotsChecker,
  ) {
    this.rawGetOptions = {
      fetchImpl: deps.fetchImpl,
      userAgent: buildUserAgent(config),
      timeoutMs: config.pageTimeoutMs,
      maxBodyBytes: config.maxBodyBytes,
    };
  }

  async fetch(requestedUrl: URL): Promise<PageFetchOutcome> {
    let current = requestedUrl;
    const redirectChain = new Set<string>([current.href]);
    let redirects = 0;
    // ページ単位リトライ予算（E10: 各分類 1 回）
    let retried5xx = false;
    let retriedTimeout = false;
    let retriedConnection = false;

    for (;;) {
      // 429 再発で打ち切り済みのドメインには一切アクセスしない（リダイレクト先を含む）
      if (this.politeness.isAborted(current.host)) {
        return { ok: false, reason: "http_4xx", domainAborted: true };
      }
      // robots 拒否はリトライ禁止・以後も取得対象にしない（E10 / 要件 6.2）。
      // robots.txt が取得不能（5xx / タイムアウト）の場合も RobotsCache が保守的に拒否する
      if (!(await this.robots.isAllowed(current))) {
        return failure("robots_denied");
      }

      const target = current;
      const result = await this.politeness.runRequest(target.host, () =>
        rawGet(target.href, this.rawGetOptions),
      );

      if (result.kind === "timeout") {
        if (retriedTimeout) return failure("timeout");
        retriedTimeout = true;
        continue; // 再試行の間隔は politeness（最小 10 秒 + ジッター）が保証する
      }
      if (result.kind === "connection_error") {
        if (retriedConnection) return failure("connection_error");
        retriedConnection = true;
        continue;
      }

      const { status } = result;

      if (status >= 300 && status < 400) {
        const location = result.headers.get("location");
        if (location === null) return failure("redirect_error");
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return failure("redirect_error");
        }
        next.hash = "";
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          return failure("redirect_error");
        }
        // shared の出典 URL 制約 + 内部アドレス遮断（SSRF 対策）を満たさない URL は追わない
        // （最終 URL は UntrustedText.sourceUrl になるため、ここで先に排除する）
        if (!isSafeCrawlUrl(next.href)) {
          return failure("redirect_error");
        }
        redirects += 1;
        if (redirects > this.config.maxRedirects) return failure("redirect_error");
        if (redirectChain.has(next.href)) return failure("redirect_error"); // ループ
        redirectChain.add(next.href);
        current = next;
        continue;
      }

      if (status === 429) {
        const retryAfterMs = parseRetryAfterMs(result.headers.get("retry-after"), this.deps.now());
        const waitMs = Math.max(retryAfterMs ?? 0, this.config.http429MinWaitMs);
        if (!this.politeness.register429(current.host, waitMs)) {
          // 同一ドメインで 2 度目の 429 → バン回避最優先で残りページを打ち切る（E10）。
          // FetchErrorKind に専用値がないため http_4xx として記録する（429 は 4xx）。
          // 観測性を上げたい場合は shared 側 enum への `rate_limited` 追加を PR1 系で提案すること
          return { ok: false, reason: "http_4xx", domainAborted: true };
        }
        continue; // 待機は politeness の nextAllowedAt 予約により次の runRequest で行われる
      }

      if (status >= 200 && status < 300) {
        if (result.tooLarge) return failure("too_large");
        const mime = parseMime(result.headers.get("content-type"));
        if (!isTextualContentType(mime)) {
          // 非テキスト Content-Type はスキップ。FetchErrorKind に専用値がないため
          // 「本文を扱えない」として too_large に分類する（design-detail 4.2 の表の 2xx スキップ行）
          return failure("too_large");
        }
        const bodyText = result.bodyText ?? "";
        const fetchedAt = new Date(this.deps.now()).toISOString();
        if (isHtmlContentType(mime)) {
          const { title, text } = extractTextFromHtml(bodyText);
          return {
            ok: true,
            finalUrl: current.href,
            fetchedAt,
            title,
            text,
            links: extractLinks(bodyText, current),
          };
        }
        return {
          ok: true,
          finalUrl: current.href,
          fetchedAt,
          title: null,
          text: normalizePlainText(bodyText),
          links: [],
        };
      }

      if (status >= 400 && status < 500) {
        return failure("http_4xx"); // リトライしない（E10）
      }

      if (status >= 500 && status < 600) {
        if (retried5xx) return failure("http_5xx");
        retried5xx = true;
        await sleep(this.config.http5xxRetryWaitMs); // E10: 5 秒待機で 1 回リトライ
        continue;
      }

      // 1xx 等の想定外ステータスは接続異常として扱う（リトライ予算も connection_error と共有）
      if (retriedConnection) return failure("connection_error");
      retriedConnection = true;
      continue;
    }
  }
}
