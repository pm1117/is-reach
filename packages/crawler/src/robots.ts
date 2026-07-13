// robots.txt の取得・評価・キャッシュ（design-detail 4.2 — 決定 E10 / 要件 6.2）。
// - 拒否は robots_denied（リトライ禁止・以後も取得対象にしない）
// - robots.txt 自体が 5xx / タイムアウト等で取得できない場合は保守的にクロールしない
// - 404（および 4xx）は「robots.txt なし = 許可」とみなす（RFC 9309 の慣行）
// - 取得結果はオリジン単位でキャッシュ（同一ジョブ = 同一 Crawler インスタンス内）
//
// パーサは RFC 9309 のサブセット（User-agent グループ / Allow / Disallow / `*` と `$` の
// パターン / 最長一致・同長 Allow 優先）を自前実装する。必要な仕様が小さく、
// 外部依存を増やさないため（テストで仕様を固定する）。
import { CRAWLER_BOT_PRODUCT_TOKEN } from "./config.js";
import { rawGet, type RawGetOptions } from "./internal/http.js";
import type { PolitenessController } from "./politeness.js";
import { isSafeCrawlUrl } from "./url-guard.js";

/** robots.txt として解釈する本文の上限（500KiB 相当 — 照合コストの有界化） */
export const MAX_ROBOTS_TXT_CHARS = 512_000;

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  userAgents: string[];
  rules: RobotsRule[];
}

export type RobotsPolicy =
  { kind: "allow_all" } | { kind: "deny_all" } | { kind: "rules"; groups: RobotsGroup[] };

/** robots.txt 本文をグループ列にパースする（不明なディレクティブは無視） */
export function parseRobotsTxt(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastLineWasUserAgent = false;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = (rawLine.split("#")[0] ?? "").trim();
    if (line === "") continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      // 連続する User-agent 行は同一グループにまとめる（RFC 9309）
      if (!lastLineWasUserAgent || current === null) {
        current = { userAgents: [], rules: [] };
        groups.push(current);
      }
      current.userAgents.push(value);
      lastLineWasUserAgent = true;
      continue;
    }
    lastLineWasUserAgent = false;
    if (field === "allow" || field === "disallow") {
      if (current === null) continue; // グループ外のルールは無視
      current.rules.push({ allow: field === "allow", pattern: value });
    }
    // crawl-delay / sitemap 等は無視する（E12 の自前間隔 10〜15 秒が常に保守的なため）
  }
  return groups;
}

/**
 * robots.txt のパスパターン（`*` ワイルドカード / 末尾 `$` アンカー）との一致判定。
 * パターンも照合対象パスも外部由来（攻撃対象サイトが制御可能）のため、正規表現は使わず
 * バックトラッキングしない線形マッチで実装する（ReDoS によるプロセス停止の防止）。
 * `*` 区切りの各セグメントを最左一致（indexOf）で貪欲に前進させる方式は、
 * 前置一致（非アンカー）・完全一致（アンカー）のどちらでも正しい判定になる。
 */
export function matchesRobotsPattern(pattern: string, path: string): boolean {
  let body = pattern;
  let anchored = false;
  if (body.endsWith("$")) {
    anchored = true;
    body = body.slice(0, -1);
  }
  const segments = body.split("*");
  const first = segments[0] ?? "";
  if (!path.startsWith(first)) return false;
  if (segments.length === 1) {
    // ワイルドカードなし: 非アンカーは前置一致、アンカーは完全一致
    return anchored ? path.length === first.length : true;
  }
  let position = first.length;
  // 中間セグメントは最左一致で前進する（末尾セグメントに最大の余地を残すため常に正しい）
  for (let i = 1; i < segments.length - 1; i += 1) {
    const segment = segments[i] ?? "";
    if (segment === "") continue;
    const index = path.indexOf(segment, position);
    if (index === -1) return false;
    position = index + segment.length;
  }
  const last = segments[segments.length - 1] ?? "";
  if (anchored) {
    const start = path.length - last.length;
    return start >= position && path.endsWith(last);
  }
  return last === "" ? true : path.indexOf(last, position) !== -1;
}

/**
 * 製品トークンに適用すべきルール集合を選ぶ。
 * 具体的な User-agent 一致（トークンの前方一致。最長のもの）を最優先し、
 * なければ `*` グループ。どちらもなければ空（= すべて許可）。
 */
export function selectRules(groups: RobotsGroup[], productToken: string): RobotsRule[] {
  const token = productToken.toLowerCase();
  let best = -1;
  const rulesBySpecificity = new Map<number, RobotsRule[]>();

  for (const group of groups) {
    let specificity = -1;
    for (const ua of group.userAgents) {
      const uaToken = ua.toLowerCase();
      if (uaToken === "*") {
        specificity = Math.max(specificity, 0);
      } else if (uaToken !== "" && token.startsWith(uaToken)) {
        specificity = Math.max(specificity, uaToken.length);
      }
    }
    if (specificity < 0) continue;
    best = Math.max(best, specificity);
    const bucket = rulesBySpecificity.get(specificity);
    if (bucket !== undefined) {
      bucket.push(...group.rules);
    } else {
      rulesBySpecificity.set(specificity, [...group.rules]);
    }
  }

  if (best < 0) return [];
  return rulesBySpecificity.get(best) ?? [];
}

/** パス（pathname + search）が許可されるか。最長一致・同長は Allow 優先・該当なしは許可 */
export function isPathAllowedByGroups(
  groups: RobotsGroup[],
  productToken: string,
  path: string,
): boolean {
  const rules = selectRules(groups, productToken);
  let bestLength = -1;
  let allowed = true;
  for (const rule of rules) {
    if (rule.pattern === "") continue; // 空の Disallow は「すべて許可」の慣行 → ルールなし扱い
    if (!matchesRobotsPattern(rule.pattern, path)) continue;
    const length = rule.pattern.length;
    if (length > bestLength) {
      bestLength = length;
      allowed = rule.allow;
    } else if (length === bestLength && rule.allow) {
      allowed = true;
    }
  }
  return bestLength < 0 ? true : allowed;
}

/** PageFetcher が依存する最小インターフェース（テストでの差し替え用） */
export interface RobotsChecker {
  isAllowed(url: URL): Promise<boolean>;
}

export interface RobotsCacheOptions {
  rawGetOptions: RawGetOptions;
  maxRedirects: number;
  politeness: PolitenessController;
}

export class RobotsCache implements RobotsChecker {
  /** オリジン → ポリシー（Promise をキャッシュし同一オリジンの同時取得を 1 回に抑える） */
  private readonly policies = new Map<string, Promise<RobotsPolicy>>();

  constructor(private readonly options: RobotsCacheOptions) {}

  async isAllowed(url: URL): Promise<boolean> {
    const policy = await this.policyFor(url.origin);
    if (policy.kind === "allow_all") return true;
    if (policy.kind === "deny_all") return false;
    return isPathAllowedByGroups(
      policy.groups,
      CRAWLER_BOT_PRODUCT_TOKEN,
      url.pathname + url.search,
    );
  }

  private policyFor(origin: string): Promise<RobotsPolicy> {
    const cached = this.policies.get(origin);
    if (cached !== undefined) return cached;
    // 想定外の例外でも保守的に「クロールしない」へ倒す（E10）
    const promise = this.fetchPolicy(origin).catch((): RobotsPolicy => ({ kind: "deny_all" }));
    this.policies.set(origin, promise);
    return promise;
  }

  private async fetchPolicy(origin: string): Promise<RobotsPolicy> {
    let current = new URL("/robots.txt", origin);
    const visited = new Set<string>([current.href]);

    for (let redirects = 0; redirects <= this.options.maxRedirects; redirects += 1) {
      const target = current;
      const result = await this.options.politeness.runRequest(target.host, () =>
        rawGet(target.href, this.options.rawGetOptions),
      );

      if (result.kind !== "response") {
        // タイムアウト・接続不能 → 保守的にクロールしない（E10）
        return { kind: "deny_all" };
      }
      if (result.status >= 200 && result.status < 300) {
        if (result.tooLarge || result.bodyText === null) {
          return { kind: "deny_all" };
        }
        // 照合コストを有界にするため先頭 500KiB 相当だけを解釈する（Google の慣行と同等。
        // 超過分のルールは無視されるが、極端に巨大な robots.txt 自体が異常系）
        return {
          kind: "rules",
          groups: parseRobotsTxt(result.bodyText.slice(0, MAX_ROBOTS_TXT_CHARS)),
        };
      }
      if (result.status >= 300 && result.status < 400) {
        const location = result.headers.get("location");
        if (location === null) return { kind: "deny_all" };
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return { kind: "deny_all" };
        }
        if (next.protocol !== "http:" && next.protocol !== "https:") return { kind: "deny_all" };
        // 内部アドレス等へのリダイレクトは追わず、保守的に「取得できない」扱いにする
        if (!isSafeCrawlUrl(next.href)) return { kind: "deny_all" };
        if (visited.has(next.href)) return { kind: "deny_all" }; // リダイレクトループ
        visited.add(next.href);
        current = next;
        continue;
      }
      if (result.status >= 400 && result.status < 500) {
        // 404 を含む 4xx は「robots.txt なし = 許可」（E10 / RFC 9309 の慣行）
        return { kind: "allow_all" };
      }
      // 5xx → 保守的にクロールしない（E10）
      return { kind: "deny_all" };
    }
    // リダイレクト超過も「取得できない」として保守的に拒否
    return { kind: "deny_all" };
  }
}
