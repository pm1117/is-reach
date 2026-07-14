// ワーカー購読の枠組み（ジョブ名 → ハンドラ登録）。
// 実ハンドラは src/workers/ 配下（深掘り deep_dive — E9、メッセージ生成
// generate_message — E13、シグナル収集 collect_signals — バッチ）。
// ハンドラ内のテナント文脈 DB アクセスは、ジョブペイロードの tenantId から
// コンテキストを復元して TenantDb.withTenantContext を通す（basic-design 7.2-4）。
import type { JobQueue, QueueJob } from "@is-reach/shared";

/** ジョブ名ごとのハンドラ登録表。未登録のジョブ名は購読しない */
export interface JobHandlers {
  deep_dive?: (job: QueueJob<"deep_dive">) => Promise<void>;
  generate_message?: (job: QueueJob<"generate_message">) => Promise<void>;
  collect_signals?: (job: QueueJob<"collect_signals">) => Promise<void>;
}

/** 登録されたハンドラ分の購読を開始する（queue は起動済みであること） */
export async function startWorkers(queue: JobQueue, handlers: JobHandlers): Promise<void> {
  if (handlers.deep_dive !== undefined) {
    await queue.subscribe("deep_dive", handlers.deep_dive);
  }
  if (handlers.generate_message !== undefined) {
    await queue.subscribe("generate_message", handlers.generate_message);
  }
  if (handlers.collect_signals !== undefined) {
    await queue.subscribe("collect_signals", handlers.collect_signals);
  }
}
