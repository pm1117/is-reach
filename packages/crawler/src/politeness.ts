// クローリング節度の中枢（design-detail 5 章 — 決定 E12、4.2 — 決定 E10 の 429 緩和）。
// - 同一ドメイン（host 単位）: 直列 1 接続 + 最小間隔 10 秒 + ジッター 0〜5 秒
// - プロセス全体: 同時 5 接続（別ドメインの並列は可）
// - 429 受信: 初回は待機して 1 回だけ再試行を許可し、以後の間隔を 2 倍に緩和。
//   再度 429 が返ったドメインは打ち切り（バン回避最優先）
import type { CrawlerConfig } from "./config.js";
import { Mutex, Semaphore, sleep } from "./internal/async.js";

export interface PolitenessDeps {
  /** 現在時刻（ms）。テストで注入可能にする */
  now: () => number;
  /** ジッター用の一様乱数 [0, 1)。テストで注入可能にする */
  random: () => number;
}

interface DomainState {
  lock: Mutex;
  /** 次のリクエストを開始してよい時刻（ms）。間隔はリクエスト開始時刻基準 */
  nextAllowedAt: number;
  intervalMultiplier: number;
  received429: boolean;
  aborted: boolean;
}

type PolitenessConfig = Pick<
  CrawlerConfig,
  "minDomainIntervalMs" | "maxJitterMs" | "globalConcurrency" | "intervalMultiplierAfter429"
>;

export class PolitenessController {
  private readonly globalSlots: Semaphore;
  private readonly domains = new Map<string, DomainState>();

  constructor(
    private readonly config: PolitenessConfig,
    private readonly deps: PolitenessDeps,
  ) {
    this.globalSlots = new Semaphore(config.globalConcurrency);
  }

  /**
   * ドメイン直列（Mutex）→ 最小間隔 + ジッターの待機 → 全体同時接続数（Semaphore）の順で
   * 制約を満たしてから task を実行する。次回開始可能時刻は今回の開始時刻を基準に予約する。
   */
  async runRequest<T>(host: string, task: () => Promise<T>): Promise<T> {
    const state = this.state(host);
    return state.lock.run(async () => {
      const waitMs = state.nextAllowedAt - this.deps.now();
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      const jitterMs = this.deps.random() * this.config.maxJitterMs;
      state.nextAllowedAt =
        this.deps.now() + this.config.minDomainIntervalMs * state.intervalMultiplier + jitterMs;
      return this.globalSlots.run(task);
    });
  }

  /**
   * 429 受信を記録する。戻り値 true なら waitMs 待機後の 1 回だけの再試行を許可
   * （待機は nextAllowedAt の予約として runRequest 側で行われる）。
   * 同一ドメインで 2 度目の 429 なら false を返し、以後そのドメインは打ち切り。
   */
  register429(host: string, waitMs: number): boolean {
    const state = this.state(host);
    if (state.received429) {
      state.aborted = true;
      return false;
    }
    state.received429 = true;
    state.intervalMultiplier = this.config.intervalMultiplierAfter429;
    state.nextAllowedAt = Math.max(state.nextAllowedAt, this.deps.now() + waitMs);
    return true;
  }

  /** 429 の再発により打ち切られたドメインか */
  isAborted(host: string): boolean {
    return this.domains.get(host)?.aborted ?? false;
  }

  /** 打ち切られたドメインの一覧（結果報告用） */
  abortedHosts(): string[] {
    return [...this.domains.entries()].filter(([, state]) => state.aborted).map(([host]) => host);
  }

  private state(host: string): DomainState {
    let state = this.domains.get(host);
    if (state === undefined) {
      state = {
        lock: new Mutex(),
        nextAllowedAt: 0,
        intervalMultiplier: 1,
        received429: false,
        aborted: false,
      };
      this.domains.set(host, state);
    }
    return state;
  }
}
