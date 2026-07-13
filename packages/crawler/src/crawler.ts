// 公開 API（basic-design 2.1: crawler の責務 = シグナル収集バッチ + 深掘りフェッチ）。
// - createCrawler() が返す 1 インスタンス = 1 ジョブ。robots.txt キャッシュ・レート制限・
//   429 打ち切り状態はインスタンス内（= 同一ジョブ内）で共有される（E10 / E12）
// - 収集結果の外部由来テキストは shared の UntrustedText（出典 URL・収集日時必須）で返し、
//   信頼境界外であることを型で表現する（basic-design 8.2。サニタイズ S1〜S5 は prompt の責務）
// - DB 書き込み・LLM 呼び出しはしない（永続化は呼び出し側 = apps/api）
import {
  httpUrlSchema,
  markUntrusted,
  type FetchErrorKind,
  type UntrustedText,
} from "@is-reach/shared";
import { z } from "zod";
import { buildUserAgent, resolveCrawlerConfig, type CrawlerConfigInput } from "./config.js";
import { PageFetcher } from "./page-fetcher.js";
import { PolitenessController } from "./politeness.js";
import { RobotsCache } from "./robots.js";
import { isSafeCrawlUrl } from "./url-guard.js";

/** 進捗通知（DeepDiveJob.progress — design-detail 2.3 — と同じ形。PR5b のジョブ進捗が使う） */
export interface CrawlProgress {
  fetchedPages: number;
  plannedPages: number | null;
}
export type ProgressCallback = (progress: CrawlProgress) => void;

export interface FetchedPage {
  /** 取得を要求した URL */
  requestedUrl: string;
  /** リダイレクト解決後の最終 URL（= text / title の出典 URL） */
  url: string;
  /** 取得日時（ISO 8601） */
  fetchedAt: string;
  /** ページタイトル（外部由来 = 信頼境界外） */
  title: UntrustedText | null;
  /** タグ除去済みのプレーンテキスト本文（外部由来 = 信頼境界外・サニタイズ前） */
  text: UntrustedText;
}

export interface PartialFailure {
  url: string;
  reason: FetchErrorKind;
}

export interface SiteCrawlResult {
  pages: FetchedPage[];
  /** 取得を試みて失敗した URL と分類（design-detail 4.1 の partialFailures） */
  partialFailures: PartialFailure[];
}

export interface DeepDiveFetchInput {
  /** 企業ドメイン（例: "example.co.jp"）または開始 URL。スキーム省略時は https とみなす */
  startUrl: string;
  onProgress?: ProgressCallback;
}

export interface DeepDiveFetchResult extends SiteCrawlResult {
  /** 429 再発により打ち切られたドメイン（E10。残りページは試行していない） */
  abortedHosts: string[];
}

export interface CollectSignalsInput {
  /** シグナル収集対象のソース URL リスト */
  sourceUrls: string[];
  onProgress?: ProgressCallback;
}

export interface SignalSourceResult extends SiteCrawlResult {
  sourceUrl: string;
}

export interface CollectSignalsResult {
  sources: SignalSourceResult[];
  abortedHosts: string[];
}

/** テスト・呼び出し側から注入可能な依存（テストは実ネットワークに出ないこと） */
export interface CrawlerDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  random?: () => number;
}

export interface Crawler {
  /** 深掘りフェッチ: 開始 URL から同一ドメイン内のリンクを辿り上限（E12: 20 ページ）まで収集する */
  deepDive(input: DeepDiveFetchInput): Promise<DeepDiveFetchResult>;
  /** シグナル収集フェッチ: 各ソース URL から上限（E12: 5 ページ）まで収集する */
  collectSignals(input: CollectSignalsInput): Promise<CollectSignalsResult>;
}

// スキーム省略（企業ドメインのみ）の入力は https として解釈してから出典 URL 制約で検証する
const SAFE_URL_ERROR =
  "クロール対象にできない URL です（内部アドレス・localhost・長すぎる URL は指定不可）";

const startUrlSchema = z
  .string()
  .trim()
  .min(1, { error: "開始 URL を指定してください" })
  .transform((value) => (value.includes("://") ? value : `https://${value}`))
  .pipe(httpUrlSchema)
  .refine(isSafeCrawlUrl, { error: SAFE_URL_ERROR });

const deepDiveInputSchema = z.object({ startUrl: startUrlSchema });

const collectSignalsInputSchema = z.object({
  sourceUrls: z
    .array(httpUrlSchema.refine(isSafeCrawlUrl, { error: SAFE_URL_ERROR }))
    .min(1, { error: "ソース URL を 1 件以上指定してください" }),
});

/** クロール予算を消費させないためリンク段階で除外する拡張子（Content-Type 検査の前段） */
const BINARY_PATH_RE =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|pdf|zip|gz|tgz|rar|7z|mp3|mp4|mov|avi|webm|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|exe|dmg)$/i;

export function createCrawler(configInput?: CrawlerConfigInput, deps?: CrawlerDeps): Crawler {
  const config = resolveCrawlerConfig(configInput);
  const resolvedDeps = {
    fetchImpl: deps?.fetchImpl ?? fetch,
    now: deps?.now ?? ((): number => Date.now()),
    random: deps?.random ?? Math.random,
  };
  const politeness = new PolitenessController(config, resolvedDeps);
  const robots = new RobotsCache({
    rawGetOptions: {
      fetchImpl: resolvedDeps.fetchImpl,
      userAgent: buildUserAgent(config),
      timeoutMs: config.pageTimeoutMs,
      maxBodyBytes: config.maxBodyBytes,
    },
    maxRedirects: config.maxRedirects,
    politeness,
  });
  const fetcher = new PageFetcher(config, resolvedDeps, politeness, robots);

  return {
    async deepDive(input: DeepDiveFetchInput): Promise<DeepDiveFetchResult> {
      const parsed = deepDiveInputSchema.parse({ startUrl: input.startUrl });
      const onProgress = input.onProgress;
      const result = await crawlSite(
        fetcher,
        politeness,
        new URL(parsed.startUrl),
        config.deepDiveMaxPages,
        (fetchedPages, plannedPages) => onProgress?.({ fetchedPages, plannedPages }),
      );
      return { ...result, abortedHosts: politeness.abortedHosts() };
    },

    async collectSignals(input: CollectSignalsInput): Promise<CollectSignalsResult> {
      const parsed = collectSignalsInputSchema.parse({ sourceUrls: input.sourceUrls });
      const onProgress = input.onProgress;
      const fetchedBySource = parsed.sourceUrls.map(() => 0);
      const plannedBySource = parsed.sourceUrls.map(() => 1);
      const notifyTotal = (): void => {
        onProgress?.({
          fetchedPages: sum(fetchedBySource),
          plannedPages: sum(plannedBySource),
        });
      };
      // ソース間（別ドメイン）は並列可。同一ドメインの直列・全体 5 接続は politeness が保証する
      const sources = await Promise.all(
        parsed.sourceUrls.map(async (sourceUrl, index): Promise<SignalSourceResult> => {
          const result = await crawlSite(
            fetcher,
            politeness,
            new URL(sourceUrl),
            config.signalSourceMaxPages,
            (fetched, planned) => {
              fetchedBySource[index] = fetched;
              plannedBySource[index] = planned;
              notifyTotal();
            },
          );
          return { sourceUrl, ...result };
        }),
      );
      return { sources, abortedHosts: politeness.abortedHosts() };
    },
  };
}

/**
 * 1 サイト（1 開始 URL）を上限ページ数まで幅優先で収集する。
 * リンクは「そのページの最終 URL と同一ホスト」のものだけを辿る
 * （www リダイレクト等でホストが確定した後のサイト内に限定する）。
 */
async function crawlSite(
  fetcher: PageFetcher,
  politeness: PolitenessController,
  startUrl: URL,
  maxPages: number,
  notify: (fetchedPages: number, plannedPages: number) => void,
): Promise<SiteCrawlResult> {
  const start = new URL(startUrl.href);
  start.hash = "";
  const queue: URL[] = [start];
  const enqueued = new Set<string>([start.href]);
  const pages: FetchedPage[] = [];
  const partialFailures: PartialFailure[] = [];
  const planned = (): number => Math.min(enqueued.size, maxPages);

  notify(pages.length, planned());

  while (pages.length < maxPages) {
    const url = queue.shift();
    if (url === undefined) break;
    // 429 再発で打ち切られたドメインの残りページは試行しない（E10: バン回避最優先）
    if (politeness.isAborted(url.host)) continue;

    const outcome = await fetcher.fetch(url);
    if (outcome.ok) {
      const sourceUrl = outcome.finalUrl;
      const collectedAt = outcome.fetchedAt;
      pages.push({
        requestedUrl: url.href,
        url: sourceUrl,
        fetchedAt: collectedAt,
        title:
          outcome.title === null
            ? null
            : markUntrusted({ text: outcome.title, sourceUrl, collectedAt }),
        text: markUntrusted({ text: outcome.text, sourceUrl, collectedAt }),
      });
      const finalHost = new URL(sourceUrl).host;
      for (const link of outcome.links) {
        if (enqueued.size >= maxPages) break; // 上限超の発見分は計画に入れない
        if (link.host !== finalHost) continue; // 同一ドメイン限定（深掘りの範囲 — E12）
        if (BINARY_PATH_RE.test(link.pathname)) continue;
        if (enqueued.has(link.href)) continue;
        // shared の出典 URL 制約 + 内部アドレス遮断（SSRF 対策）を満たさない URL は収集対象にしない
        if (!isSafeCrawlUrl(link.href)) continue;
        enqueued.add(link.href);
        queue.push(link);
      }
    } else {
      partialFailures.push({ url: url.href, reason: outcome.reason });
    }
    notify(pages.length, planned());
  }

  return { pages, partialFailures };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
