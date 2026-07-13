// ジョブキュー抽象の型契約（basic-design 4.4 — 決定 D5）。
//
// pg-boss を将来 SQS / BullMQ 等へ差し替え可能にするため、apps/api（ワーカー）は
// このインターフェースにのみ依存する。実装（pg-boss アダプタ）は apps/api 側に置き、
// shared には型のみを置く（shared の実行時 I/O 禁止 — basic-design 2.1）。
import { z } from "zod";
import { uuidSchema } from "./common.js";

/** ジョブ名（キュー名）。追加時は QueueJobPayloadMap にも対応を追加する */
export const queueJobNameSchema = z.enum(["deep_dive", "generate_message"]);
export type QueueJobName = z.infer<typeof queueJobNameSchema>;

/** 深掘りジョブのペイロード（本体レコードは DB の deep_dive_jobs — 決定 E9） */
export const deepDiveJobPayloadSchema = z.object({
  deepDiveJobId: uuidSchema,
});
export type DeepDiveJobPayload = z.infer<typeof deepDiveJobPayloadSchema>;

/** メッセージ生成ジョブのペイロード */
export const generateMessageJobPayloadSchema = z.object({
  messageJobId: uuidSchema,
});
export type GenerateMessageJobPayload = z.infer<typeof generateMessageJobPayloadSchema>;

/** ジョブ名 → ペイロード型の対応（enqueue / subscribe の型安全性を担保する） */
export interface QueueJobPayloadMap {
  deep_dive: DeepDiveJobPayload;
  generate_message: GenerateMessageJobPayload;
}

export interface EnqueueOptions {
  /** リトライ上限（既定は実装側の設定に従う） */
  retryLimit?: number;
  /** 遅延実行（秒） */
  startAfterSeconds?: number;
  /** 多重投入防止キー（例: 同一エントリの実行中ジョブ重複防止 — JOB_ALREADY_RUNNING） */
  singletonKey?: string;
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

  /** 購読を停止しリソースを解放する */
  stop(): Promise<void>;
}
