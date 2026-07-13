// クロール対象 URL の安全性ガード。
// crawler は「外部 HTTP アクセスの唯一の実装点」（basic-design 2.1）のため、SSRF 的な
// 内部リソースへの到達をここで一元的に遮断する（開始 URL・ページ内リンク・リダイレクト先・
// robots.txt のリダイレクト先すべてに適用する）。
// 注意: これは URL リテラルに対する防御であり、DNS リバインディング等の名前解決レベルの
// 攻撃は防げない（運用ではネットワーク層の egress 制限を併用すること — 要検討事項として報告済み）。
import { httpUrlSchema } from "@is-reach/shared";

/** クロール対象として扱う URL の長さ上限（節度・robots 照合コストの有界化） */
export const MAX_CRAWL_URL_LENGTH = 2048;

/**
 * クロールしてはならないホストか。
 * - localhost / *.localhost
 * - プライベート・予約レンジの IPv4 リテラル（RFC1918・ループバック・リンクローカル・
 *   CGNAT・ベンチマーク・ドキュメンテーション・マルチキャスト以上）
 * - IPv6 リテラル全般（正規のクロール対象で使われることは実質なく、レンジ判定の
 *   複雑さを避けて保守的に全て拒否する）
 */
export function isForbiddenCrawlHost(hostname: string): boolean {
  // FQDN 表記（末尾ドット。例: "localhost."）でのバイパスを防ぐため先に除去する
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // クラウドメタデータの既知ホスト名と、私設ネットワーク予約 TLD（.internal）。
  // IP レンジ遮断（169.254/16 等）を名前解決前にすり抜ける経路への低コストな上積み
  if (host === "metadata.google.internal") return true;
  if (host === "internal" || host.endsWith(".internal")) return true;
  // IPv6 リテラルは hostname に ":" を含む（WHATWG URL の hostname は角括弧を保持するが、
  // 角括弧の有無に依存しない判定にしている）
  if (host.includes(":")) return true;
  const octets = parseIpv4(host);
  if (octets !== null) return isPrivateOrReservedIpv4(octets);
  return false;
}

/**
 * クロール対象として安全な URL か。
 * shared の出典 URL 制約（httpUrlSchema: https? のみ・危険文字なし）+ 長さ上限 + ホストガード。
 */
export function isSafeCrawlUrl(href: string): boolean {
  if (href.length > MAX_CRAWL_URL_LENGTH) return false;
  if (!httpUrlSchema.safeParse(href).success) return false;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  return !isForbiddenCrawlHost(url.hostname);
}

function parseIpv4(host: string): [number, number, number, number] | null {
  // WHATWG URL は数値ホスト（例: http://2130706433/）をドット区切り 10 進へ正規化するため、
  // この形式の照合で IPv4 リテラルを網羅できる
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (match === null) return null;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0];
}

function isPrivateOrReservedIpv4([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8, 10/8, ループバック
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // リンクローカル（クラウドメタデータ含む）
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0/24・TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // ベンチマーク 198.18/15
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // マルチキャスト・予約
  return false;
}
