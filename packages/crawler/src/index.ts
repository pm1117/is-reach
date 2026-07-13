// @is-reach/crawler: 外部サイトへの HTTP アクセスの唯一の実装点（basic-design 2.1）。
// robots.txt 遵守（E10）・クローリング節度（E12）・HTTP エラー分類 → FetchErrorKind（E10）・
// HTML → プレーンテキスト抽出をここに集約する。依存は packages/shared のみ。
export {
  CRAWLER_BOT_PRODUCT_TOKEN,
  PLACEHOLDER_BOT_INFO_URL,
  PLACEHOLDER_CONTACT,
  buildUserAgent,
  crawlerConfigSchema,
  hasPlaceholderUserAgent,
  resolveCrawlerConfig,
  type CrawlerConfig,
  type CrawlerConfigInput,
} from "./config.js";
export {
  createCrawler,
  type CollectSignalsInput,
  type CollectSignalsResult,
  type CrawlProgress,
  type Crawler,
  type CrawlerDeps,
  type DeepDiveFetchInput,
  type DeepDiveFetchResult,
  type FetchedPage,
  type PartialFailure,
  type ProgressCallback,
  type SignalSourceResult,
  type SiteCrawlResult,
} from "./crawler.js";
export { extractLinks, extractTextFromHtml, normalizePlainText } from "./html-to-text.js";
export {
  MAX_ROBOTS_TXT_CHARS,
  isPathAllowedByGroups,
  matchesRobotsPattern,
  parseRobotsTxt,
  type RobotsGroup,
  type RobotsRule,
} from "./robots.js";
export { MAX_CRAWL_URL_LENGTH, isForbiddenCrawlHost, isSafeCrawlUrl } from "./url-guard.js";
