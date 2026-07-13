// クローリング節度の設定（design-detail 5 章「レート制限具体値」— 決定 E12、4.2 — 決定 E10）。
// 既定値は設計の決定値。運用値は呼び出し側（apps/api）から部分的に注入して上書きできる。
import { z } from "zod";

/** robots.txt の User-agent 行との照合に使う製品トークン */
export const CRAWLER_BOT_PRODUCT_TOKEN = "is-reach-bot";

/**
 * User-Agent のプレースホルダ既定値。
 * bot 説明ページ URL・連絡先は運用開始前に必ず実値へ差し替える（design-detail 8 章の残仮置き —
 * PR7 の運用ドキュメントに設定手順を記載）。`.invalid` TLD のため実在ドメインと衝突しない。
 */
export const PLACEHOLDER_BOT_INFO_URL =
  "https://bot-info.is-reach.invalid/REPLACE-BEFORE-OPERATION";
export const PLACEHOLDER_CONTACT = "crawler-contact-REPLACE-BEFORE-OPERATION@is-reach.invalid";

const userAgentConfigSchema = z.object({
  /** is-reach-bot/<version> の version 部 */
  version: z.string().min(1).default("0.1.0"),
  /** bot 説明ページ URL（運用開始前に実値必須 — 仮置き） */
  botInfoUrl: z.string().min(1).default(PLACEHOLDER_BOT_INFO_URL),
  /** 連絡先（運用開始前に実値必須 — 仮置き） */
  contact: z.string().min(1).default(PLACEHOLDER_CONTACT),
});

export const crawlerConfigSchema = z.object({
  /** 同一ドメインへのリクエスト間隔の最小値（E12: 10 秒） */
  minDomainIntervalMs: z.number().int().positive().default(10_000),
  /** 間隔へ加算するジッターの上限（E12: +0〜5 秒の一様乱数。機械的な等間隔を避ける） */
  maxJitterMs: z.number().int().min(0).default(5_000),
  /**
   * クローラープロセス全体の同時接続数（E12: 5。別ドメインの並列は可）。
   * 同一ドメインの同時接続は 1（直列）で固定 — 設定値ではなくドメイン単位 Mutex の構造で保証する。
   */
  globalConcurrency: z.number().int().positive().default(5),
  /** 深掘り 1 サイトの取得ページ上限（E12: 20） */
  deepDiveMaxPages: z.number().int().positive().default(20),
  /** シグナル収集 1 ソースの取得ページ上限（E12: 5） */
  signalSourceMaxPages: z.number().int().positive().default(5),
  /** 1 ページのタイムアウト（E12: 15 秒。接続から本文読み切りまでを含む） */
  pageTimeoutMs: z.number().int().positive().default(15_000),
  /** 本文サイズ上限（E12: 2MB。超過は too_large としてスキップ） */
  maxBodyBytes: z
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024),
  /** リダイレクト追従の上限（E10: 3 回。ループ・超過は redirect_error） */
  maxRedirects: z.number().int().min(0).default(3),
  /** 429 時の最低待機時間（E10: Retry-After とこの値の大きい方を待って 1 回だけ再試行） */
  http429MinWaitMs: z.number().int().min(0).default(60_000),
  /** 429 後に当該ドメインの最小間隔へ掛ける倍率（E10: 2 倍 = 実効 20〜30 秒 + ジッター） */
  intervalMultiplierAfter429: z.number().min(1).default(2),
  /** 5xx リトライ前の待機時間（E10: 5 秒） */
  http5xxRetryWaitMs: z.number().int().min(0).default(5_000),
  /** User-Agent の構成要素（E12） */
  userAgent: userAgentConfigSchema.default({
    version: "0.1.0",
    botInfoUrl: PLACEHOLDER_BOT_INFO_URL,
    contact: PLACEHOLDER_CONTACT,
  }),
});

export type CrawlerConfig = z.output<typeof crawlerConfigSchema>;
export type CrawlerConfigInput = z.input<typeof crawlerConfigSchema>;

/** 部分指定の設定を検証し、既定値（E12 / E10 の決定値）で補完する */
export function resolveCrawlerConfig(input?: CrawlerConfigInput): CrawlerConfig {
  return crawlerConfigSchema.parse(input ?? {});
}

/** E12 の書式: `is-reach-bot/<version> (+<bot説明ページURL>; contact: <連絡先>)` */
export function buildUserAgent(config: CrawlerConfig): string {
  const { version, botInfoUrl, contact } = config.userAgent;
  return `${CRAWLER_BOT_PRODUCT_TOKEN}/${version} (+${botInfoUrl}; contact: ${contact})`;
}

/**
 * User-Agent がプレースホルダのままかどうか。
 * 呼び出し側（apps/api）は起動時にこれを確認し、運用環境では実値の設定を必須とすること。
 */
export function hasPlaceholderUserAgent(config: CrawlerConfig): boolean {
  return (
    config.userAgent.botInfoUrl === PLACEHOLDER_BOT_INFO_URL ||
    config.userAgent.contact === PLACEHOLDER_CONTACT
  );
}
