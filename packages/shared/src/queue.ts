// ジョブキュー抽象の型契約（basic-design 4.4 — 決定 D5）。
//
// pg-boss を将来 SQS / BullMQ 等へ差し替え可能にするため、apps/api（ワーカー）は
// このインターフェースにのみ依存する。実装（pg-boss アダプタ）は apps/api 側に置き、
// shared には型のみを置く（shared の実行時 I/O 禁止 — basic-design 2.1）。
import { z } from "zod";
import { uuidSchema } from "./common.js";

/** ジョブ名（キュー名）。追加時は QueueJobPayloadMap にも対応を追加する */
export const queueJobNameSchema = z.enum(["deep_dive", "generate_message", "collect_signals"]);
export type QueueJobName = z.infer<typeof queueJobNameSchema>;

/**
 * 深掘りジョブのペイロード（本体レコードは DB の deep_dive_jobs — 決定 E9）。
 * tenantId を含むのは、ワーカーがジョブペイロードからテナントコンテキストを復元し
 * 同じ RLS 経路で DB にアクセスするため（basic-design 7.2-4）。
 */
export const deepDiveJobPayloadSchema = z.object({
  deepDiveJobId: uuidSchema,
  tenantId: uuidSchema,
});
export type DeepDiveJobPayload = z.infer<typeof deepDiveJobPayloadSchema>;

/** メッセージ生成ジョブのペイロード（tenantId の意味は deep_dive と同じ — 7.2-4） */
export const generateMessageJobPayloadSchema = z.object({
  messageJobId: uuidSchema,
  tenantId: uuidSchema,
});
export type GenerateMessageJobPayload = z.infer<typeof generateMessageJobPayloadSchema>;

/**
 * シグナル収集バッチのペイロード（テナント文脈なし — 共有資産へ app_batch で書き込む。
 * 収集対象シードは環境設定値のため空オブジェクト）
 */
export const collectSignalsJobPayloadSchema = z.object({});
export type CollectSignalsJobPayload = z.infer<typeof collectSignalsJobPayloadSchema>;

/** ジョブ名 → ペイロード型の対応（enqueue / subscribe の型安全性を担保する） */
export interface QueueJobPayloadMap {
  deep_dive: DeepDiveJobPayload;
  generate_message: GenerateMessageJobPayload;
  collect_signals: CollectSignalsJobPayload;
}

export interface EnqueueOptions {
  /** リトライ上限（既定は実装側の設定に従う） */
  retryLimit?: number;
  /** 遅延実行（秒） */
  startAfterSeconds?: number;
  /** 多重投入防止キー（例: 同一エントリの実行中ジョブ重複防止 — JOB_ALREADY_RUNNING） */
  singletonKey?: string;
  /**
   * 同時実行制御のグループキー（例: tenant_id）。
   * 実装側でグループ単位の同時実行数を制限する（E9: テナントあたり同時実行 3）
   */
  groupKey?: string;
}

/** ワーカーが受け取るジョブ */
export interface QueueJob<TName extends QueueJobName = QueueJobName> {
  id: string;
  name: TName;
  payload: QueueJobPayloadMap[TName];
}

/**
 * キュー抽象の最小インターフェース。
 * 実装はペイロードを対応する zod スキーマで検証してからハンドラへ渡すこと
 * （キュー格納中に改変されない前提を置かない）。
 */
export interface JobQueue {
  /** ジョブを投入し、ジョブ ID を返す */
  enqueue<TName extends QueueJobName>(
    name: TName,
    payload: QueueJobPayloadMap[TName],
    options?: EnqueueOptions,
  ): Promise<string>;

  /** ジョブ名ごとの購読を開始する（apps/api のワーカーが使用） */
  subscribe<TName extends QueueJobName>(
    name: TName,
    handler: (job: QueueJob<TName>) => Promise<void>,
  ): Promise<void>;

  /**
   * cron スケジュールでの定期投入を登録する（例: シグナル収集バッチ — 日次深夜帯。
   * 同名スケジュールは上書き = 冪等であること）
   */
  schedule<TName extends QueueJobName>(
    name: TName,
    cron: string,
    payload: QueueJobPayloadMap[TName],
  ): Promise<void>;

  /** 購読を停止しリソースを解放する */
  stop(): Promise<void>;
}
