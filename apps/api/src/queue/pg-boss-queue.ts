// pg-boss アダプタ（basic-design 4.4 — 決定 D5 / E1）。
// shared の JobQueue 抽象を実装する。apps/api の業務コードは JobQueue にのみ依存し、
// pg-boss への依存はこのファイルに閉じる（将来 SQS / BullMQ 等へ差し替え可能）。
//
// - 専用スキーマ pgboss・同一 Postgres（E1）。テーブルは start() 時に pg-boss が
//   自己マイグレーションで作成する（PR5a の 20260714000600 で app_batch に
//   usage + create 付与済み）。
// - 接続ロールは app_batch（design-detail 6.1: pg-boss 管理は app_batch）。
// - ペイロードはキュー格納中に改変されない前提を置かず、enqueue / subscribe の両側で
//   zod 検証する（shared/queue.ts の規約）。
// - キュー既定値（E9 / 4.1）: deep_dive はリトライ 2 回・指数バックオフ 30 秒 →
//   最大 2 分・ジョブ全体 15 分（expireInSeconds）・テナントあたり同時 3
//   （enqueue の groupKey = tenant_id + ワーカーの groupConcurrency）。
import { PgBoss, type SendOptions } from "pg-boss";
import {
  collectSignalsJobPayloadSchema,
  deepDiveJobPayloadSchema,
  generateMessageJobPayloadSchema,
  queueJobNameSchema,
  type EnqueueOptions,
  type JobQueue,
  type QueueJob,
  type QueueJobName,
  type QueueJobPayloadMap,
} from "@is-reach/shared";
import type { z } from "zod";

/** ジョブ名 → ペイロードスキーマの対応（QueueJobPayloadMap と satisfies で同期を強制） */
const PAYLOAD_SCHEMAS = {
  deep_dive: deepDiveJobPayloadSchema,
  generate_message: generateMessageJobPayloadSchema,
  collect_signals: collectSignalsJobPayloadSchema,
} satisfies { [K in QueueJobName]: z.ZodType<QueueJobPayloadMap[K]> };

function parsePayload<TName extends QueueJobName>(
  name: TName,
  data: unknown,
): QueueJobPayloadMap[TName] {
  // インデックスアクセスではスキーマ型がユニオンに落ちるため、対応表（satisfies で検証済み）を
  // 前提に個別スキーマへ狭める
  const schema = PAYLOAD_SCHEMAS[name] as unknown as z.ZodType<QueueJobPayloadMap[TName]>;
  return schema.parse(data);
}

/** singletonKey 重複等で pg-boss がジョブを投入しなかった（send が null を返した） */
export class JobNotEnqueuedError extends Error {
  constructor(name: QueueJobName) {
    super(
      `ジョブ ${name} は投入されませんでした（singletonKey の重複 — 実行中ジョブあり — の可能性）`,
    );
    this.name = "JobNotEnqueuedError";
  }
}

/** キュー作成時の既定値（pg-boss QueueOptions のサブセット） */
export interface QueueDefaults {
  /** ジョブレベル自動リトライ回数（E9: deep_dive は 2） */
  retryLimit?: number;
  /** リトライ初回待機（秒）。retryBackoff = true で指数化 */
  retryDelaySeconds?: number;
  retryBackoff?: boolean;
  /** リトライ待機の上限（秒）（E9: 2 分） */
  retryDelayMaxSeconds?: number;
  /** ジョブ実行の上限時間（秒）（E9: ジョブ全体タイムアウト 15 分） */
  expireInSeconds?: number;
}

/** 購読時のワーカー設定 */
export interface WorkerDefaults {
  /** グループ（enqueue の groupKey）単位の同時実行上限（E9: テナントあたり 3） */
  groupConcurrency?: number;
}

export type QueueSettings = {
  [K in QueueJobName]: { queue: QueueDefaults; worker: WorkerDefaults };
};

/** ジョブ名ごとの設定（design-detail 4.1 の決定値を既定とする） */
export const DEFAULT_QUEUE_SETTINGS: QueueSettings = {
  deep_dive: {
    queue: {
      retryLimit: 2,
      retryDelaySeconds: 30,
      retryBackoff: true,
      retryDelayMaxSeconds: 120,
      expireInSeconds: 15 * 60,
    },
    worker: { groupConcurrency: 3 },
  },
  generate_message: {
    // 生成は短時間（E13）。自動リトライ 1 回・上限 5 分（提案値 — 実装判断）
    queue: { retryLimit: 1, expireInSeconds: 5 * 60 },
    worker: {},
  },
  collect_signals: {
    // バッチはジョブレベル自動リトライしない（次回 cron で再実行 — 実装判断）
    queue: { retryLimit: 0, expireInSeconds: 60 * 60 },
    worker: {},
  },
};

/** テスト注入用の最小 pg-boss 型（PgBoss はこれを構造的に満たす） */
export interface PgBossLike {
  start(): Promise<unknown>;
  stop(options?: { graceful?: boolean }): Promise<void>;
  createQueue(
    name: string,
    options?: {
      retryLimit?: number;
      retryDelay?: number;
      retryBackoff?: boolean;
      retryDelayMax?: number;
      expireInSeconds?: number;
    },
  ): Promise<void>;
  send(name: string, data: object, options?: SendOptions): Promise<string | null>;
  work(
    name: string,
    options: { batchSize?: number; groupConcurrency?: number },
    handler: (jobs: { id: string; name: string; data: unknown }[]) => Promise<void>,
  ): Promise<string>;
  schedule(name: string, cron: string, data?: object | null): Promise<void>;
}

function toSendOptions(options: EnqueueOptions | undefined): SendOptions | undefined {
  if (options === undefined) return undefined;
  const sendOptions: SendOptions = {};
  if (options.retryLimit !== undefined) sendOptions.retryLimit = options.retryLimit;
  if (options.startAfterSeconds !== undefined) sendOptions.startAfter = options.startAfterSeconds;
  if (options.singletonKey !== undefined) sendOptions.singletonKey = options.singletonKey;
  if (options.groupKey !== undefined) sendOptions.group = { id: options.groupKey };
  return sendOptions;
}

export interface PgBossQueueOptions {
  /** app_batch ロールの接続文字列 */
  connectionString: string;
}

export class PgBossJobQueue implements JobQueue {
  readonly #boss: PgBossLike;
  readonly #settings: QueueSettings;
  #started = false;

  constructor(boss: PgBossLike, settings: QueueSettings = DEFAULT_QUEUE_SETTINGS) {
    this.#boss = boss;
    this.#settings = settings;
  }

  static fromConnectionString(options: PgBossQueueOptions): PgBossJobQueue {
    return new PgBossJobQueue(
      new PgBoss({ connectionString: options.connectionString, schema: "pgboss" }),
    );
  }

  /** pg-boss を起動（自己マイグレーション込み）し、全ジョブ名のキューを作成する */
  async start(): Promise<void> {
    if (this.#started) return;
    await this.#boss.start();
    for (const name of queueJobNameSchema.options) {
      const defaults = this.#settings[name].queue;
      await this.#boss.createQueue(name, {
        ...(defaults.retryLimit !== undefined ? { retryLimit: defaults.retryLimit } : {}),
        ...(defaults.retryDelaySeconds !== undefined
          ? { retryDelay: defaults.retryDelaySeconds }
          : {}),
        ...(defaults.retryBackoff !== undefined ? { retryBackoff: defaults.retryBackoff } : {}),
        ...(defaults.retryDelayMaxSeconds !== undefined
          ? { retryDelayMax: defaults.retryDelayMaxSeconds }
          : {}),
        ...(defaults.expireInSeconds !== undefined
          ? { expireInSeconds: defaults.expireInSeconds }
          : {}),
      });
    }
    this.#started = true;
  }

  async enqueue<TName extends QueueJobName>(
    name: TName,
    payload: QueueJobPayloadMap[TName],
    options?: EnqueueOptions,
  ): Promise<string> {
    const parsed = parsePayload(name, payload);
    const jobId = await this.#boss.send(name, parsed, toSendOptions(options));
    if (jobId === null) {
      throw new JobNotEnqueuedError(name);
    }
    return jobId;
  }

  async subscribe<TName extends QueueJobName>(
    name: TName,
    handler: (job: QueueJob<TName>) => Promise<void>,
  ): Promise<void> {
    const worker = this.#settings[name].worker;
    // batchSize は 1（1 ジョブずつ）。ハンドラの throw で当該ジョブが failed になり、
    // キューのリトライ方針（createQueue の既定値）に従って再試行される。
    await this.#boss.work(
      name,
      {
        batchSize: 1,
        ...(worker.groupConcurrency !== undefined
          ? { groupConcurrency: worker.groupConcurrency }
          : {}),
      },
      async (jobs) => {
        for (const job of jobs) {
          const payload = parsePayload(name, job.data);
          await handler({ id: job.id, name, payload });
        }
      },
    );
  }

  async schedule<TName extends QueueJobName>(
    name: TName,
    cron: string,
    payload: QueueJobPayloadMap[TName],
  ): Promise<void> {
    const parsed = parsePayload(name, payload);
    // pg-boss の schedule は同名スケジュールを上書きする（冪等）
    await this.#boss.schedule(name, cron, parsed);
  }

  async stop(): Promise<void> {
    await this.#boss.stop({ graceful: true });
  }
}
