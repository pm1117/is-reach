// pg-boss アダプタ（D5 / E1）のテスト。モック PgBossLike で
// 起動シーケンス（キュー既定値）・ペイロード検証（enqueue / subscribe 両側）・
// グループ同時実行・スケジュール登録を検証する。
// 実 Postgres での自己マイグレーション検証は pnpm test:db 側の責務。
import type { QueueJob } from "@is-reach/shared";
import type { SendOptions } from "pg-boss";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  JobNotEnqueuedError,
  PgBossJobQueue,
  type PgBossLike,
} from "../src/queue/pg-boss-queue.js";
import { startWorkers } from "../src/queue/worker.js";
import { TEST_TENANT_ID, TEST_USER_ID } from "./helpers.js";

const JOB_UUID = TEST_USER_ID;

type RawJob = { id: string; name: string; data: unknown };
type RawHandler = (jobs: RawJob[]) => Promise<void>;
type WorkOptions = { batchSize?: number; groupConcurrency?: number };
type CreateQueueOptions = {
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  retryDelayMax?: number;
  expireInSeconds?: number;
};

class FakePgBoss implements PgBossLike {
  started = 0;
  stoppedWith: { graceful?: boolean } | undefined;
  readonly createdQueues: { name: string; options: CreateQueueOptions | undefined }[] = [];
  readonly sent: { name: string; data: object; options: SendOptions | undefined }[] = [];
  readonly workers = new Map<string, { options: WorkOptions; handler: RawHandler }>();
  readonly schedules: { name: string; cron: string; data: object | null | undefined }[] = [];
  sendResult: string | null = "job-id-1";

  async start(): Promise<unknown> {
    this.started += 1;
    return this;
  }

  async stop(options?: { graceful?: boolean }): Promise<void> {
    this.stoppedWith = options;
  }

  async createQueue(name: string, options?: CreateQueueOptions): Promise<void> {
    this.createdQueues.push({ name, options });
  }

  async send(name: string, data: object, options?: SendOptions): Promise<string | null> {
    this.sent.push({ name, data, options });
    return this.sendResult;
  }

  async work(name: string, options: WorkOptions, handler: RawHandler): Promise<string> {
    this.workers.set(name, { options, handler });
    return `worker-${name}`;
  }

  async schedule(name: string, cron: string, data?: object | null): Promise<void> {
    this.schedules.push({ name, cron, data });
  }
}

describe("PgBossJobQueue（JobQueue 抽象の pg-boss 実装）", () => {
  it("start() で pg-boss 起動 → 全ジョブ名のキューを設計既定値付きで作成", async () => {
    const boss = new FakePgBoss();
    const queue = new PgBossJobQueue(boss);
    await queue.start();
    expect(boss.started).toBe(1);
    expect(boss.createdQueues.map((q) => q.name).sort()).toEqual([
      "collect_signals",
      "deep_dive",
      "generate_message",
    ]);
    // deep_dive は E9 / 4.1 の決定値（リトライ 2・バックオフ 30 秒 → 最大 2 分・全体 15 分）
    const deepDive = boss.createdQueues.find((q) => q.name === "deep_dive");
    expect(deepDive?.options).toEqual({
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      retryDelayMax: 120,
      expireInSeconds: 900,
    });
    // 二重 start は no-op
    await queue.start();
    expect(boss.started).toBe(1);
  });

  it("enqueue はペイロードを zod 検証してから send する（singletonKey / group 対応込み）", async () => {
    const boss = new FakePgBoss();
    const queue = new PgBossJobQueue(boss);
    const jobId = await queue.enqueue(
      "deep_dive",
      { deepDiveJobId: JOB_UUID, tenantId: TEST_TENANT_ID },
      {
        retryLimit: 2,
        startAfterSeconds: 30,
        singletonKey: `deep_dive:${JOB_UUID}`,
        groupKey: TEST_TENANT_ID,
      },
    );
    expect(jobId).toBe("job-id-1");
    expect(boss.sent).toEqual([
      {
        name: "deep_dive",
        data: { deepDiveJobId: JOB_UUID, tenantId: TEST_TENANT_ID },
        options: {
          retryLimit: 2,
          startAfter: 30,
          singletonKey: `deep_dive:${JOB_UUID}`,
          group: { id: TEST_TENANT_ID },
        },
      },
    ]);
  });

  it("不正ペイロード（tenantId 欠落等）は send 前に拒否する", async () => {
    const boss = new FakePgBoss();
    const queue = new PgBossJobQueue(boss);
    await expect(
      queue.enqueue("deep_dive", { deepDiveJobId: JOB_UUID } as never),
    ).rejects.toThrowError(ZodError);
    expect(boss.sent).toHaveLength(0);
  });

  it("send が null（singletonKey 重複等）→ JobNotEnqueuedError", async () => {
    const boss = new FakePgBoss();
    boss.sendResult = null;
    const queue = new PgBossJobQueue(boss);
    await expect(
      queue.enqueue("generate_message", { messageJobId: JOB_UUID, tenantId: TEST_TENANT_ID }),
    ).rejects.toThrowError(JobNotEnqueuedError);
  });

  it("subscribe したハンドラは検証済みペイロードを受け取る（deep_dive は groupConcurrency 3）", async () => {
    const boss = new FakePgBoss();
    const queue = new PgBossJobQueue(boss);
    const received: QueueJob<"deep_dive">[] = [];
    await queue.subscribe("deep_dive", async (job) => {
      received.push(job);
    });

    const worker = boss.workers.get("deep_dive");
    expect(worker?.options).toEqual({ batchSize: 1, groupConcurrency: 3 });
    await worker?.handler([
      {
        id: "j-1",
        name: "deep_dive",
        data: { deepDiveJobId: JOB_UUID, tenantId: TEST_TENANT_ID },
      },
    ]);
    expect(received).toEqual([
      {
        id: "j-1",
        name: "deep_dive",
        payload: { deepDiveJobId: JOB_UUID, tenantId: TEST_TENANT_ID },
      },
    ]);
  });

  it("キュー格納中に壊れたペイロードはハンドラへ渡さず失敗させる", async () => {
    const boss = new FakePgBoss();
    const queue = new PgBossJobQueue(boss);
    let called = false;
    await queue.subscribe("deep_dive", async () => {
      called = true;
    });

    const worker = boss.workers.get("deep_dive");
    await expect(
      worker?.handler([{ id: "j-2", name: "deep_dive", data: { evil: true } }]),
    ).rejects.toThrowError(ZodError);
    expect(called).toBe(false);
  });

  it("schedule はペイロード検証のうえ cron を登録する（冪等 = pg-boss 側で上書き）", async () => {
    const boss = new FakePgBoss();
    const queue = new PgBossJobQueue(boss);
    await queue.schedule("collect_signals", "0 18 * * *", {});
    expect(boss.schedules).toEqual([{ name: "collect_signals", cron: "0 18 * * *", data: {} }]);
  });

  it("stop はグレースフル停止を要求する", async () => {
    const boss = new FakePgBoss();
    const queue = new PgBossJobQueue(boss);
    await queue.stop();
    expect(boss.stoppedWith).toEqual({ graceful: true });
  });
});

describe("startWorkers（ジョブ名 → ハンドラ登録の枠組み）", () => {
  it("登録されたハンドラのジョブ名だけ購読する", async () => {
    const boss = new FakePgBoss();
    const queue = new PgBossJobQueue(boss);
    await startWorkers(queue, {
      deep_dive: async () => {},
      collect_signals: async () => {},
    });
    expect([...boss.workers.keys()].sort()).toEqual(["collect_signals", "deep_dive"]);
  });

  it("ハンドラ未登録なら何も購読しない", async () => {
    const boss = new FakePgBoss();
    const queue = new PgBossJobQueue(boss);
    await startWorkers(queue, {});
    expect(boss.workers.size).toBe(0);
  });
});
