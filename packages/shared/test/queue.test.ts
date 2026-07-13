import { describe, expect, it } from "vitest";
import {
  deepDiveJobPayloadSchema,
  generateMessageJobPayloadSchema,
  queueJobNameSchema,
} from "../src/index.js";
import type { JobQueue, QueueJob, QueueJobName, QueueJobPayloadMap } from "../src/index.js";
import { UUID_A } from "./helpers.js";

describe("キュー抽象の型契約（basic-design 4.4 — 決定 D5）", () => {
  it("ジョブ名 enum の正常系/異常系", () => {
    expect(queueJobNameSchema.parse("deep_dive")).toBe("deep_dive");
    expect(queueJobNameSchema.parse("generate_message")).toBe("generate_message");
    expect(queueJobNameSchema.safeParse("send_email").success).toBe(false);
  });

  it("ペイロードスキーマの正常系/異常系", () => {
    expect(deepDiveJobPayloadSchema.parse({ deepDiveJobId: UUID_A }).deepDiveJobId).toBe(UUID_A);
    expect(deepDiveJobPayloadSchema.safeParse({}).success).toBe(false);
    expect(deepDiveJobPayloadSchema.safeParse({ deepDiveJobId: "x" }).success).toBe(false);
    expect(generateMessageJobPayloadSchema.parse({ messageJobId: UUID_A }).messageJobId).toBe(
      UUID_A,
    );
    expect(generateMessageJobPayloadSchema.safeParse({ messageJobId: 1 }).success).toBe(false);
  });

  it("JobQueue インターフェースをインメモリ実装できる（型契約の実装可能性の確認）", async () => {
    const enqueued: { name: QueueJobName; payload: unknown }[] = [];
    const queue: JobQueue = {
      enqueue: (name, payload) => {
        enqueued.push({ name, payload });
        return Promise.resolve(`job-${enqueued.length}`);
      },
      subscribe: <TName extends QueueJobName>(
        _name: TName,
        _handler: (job: QueueJob<TName>) => Promise<void>,
      ) => Promise.resolve(),
      stop: () => Promise.resolve(),
    };

    const jobId = await queue.enqueue("deep_dive", { deepDiveJobId: UUID_A });
    expect(jobId).toBe("job-1");

    // 型レベル: ジョブ名とペイロード型の対応が強制される
    // @ts-expect-error deep_dive のペイロードに messageJobId は指定できない
    await queue.enqueue("deep_dive", { messageJobId: UUID_A });

    // QueueJobPayloadMap がジョブ名を網羅していることの確認
    const payloadKeys: keyof QueueJobPayloadMap = "deep_dive" as QueueJobName;
    expect(payloadKeys).toBeDefined();
  });
});
