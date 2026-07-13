import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCrawlerConfig } from "../src/config.js";
import { PolitenessController, type PolitenessDeps } from "../src/politeness.js";

const realDeps: PolitenessDeps = { now: () => Date.now(), random: Math.random };

describe("PolitenessController（フェイクタイマー）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("同一ドメインは最小 10 秒 + ジッターの間隔になり、機械的な等間隔にならない（E12）", async () => {
    const randomValues = [0.2, 0.8, 0.4];
    let randomIndex = 0;
    const controller = new PolitenessController(resolveCrawlerConfig(), {
      now: () => Date.now(),
      random: () => randomValues[randomIndex++ % randomValues.length] ?? 0,
    });
    const startTimes: number[] = [];
    const task = (): Promise<void> => {
      startTimes.push(Date.now());
      return Promise.resolve();
    };
    const all = Promise.all([
      controller.runRequest("a.example", task),
      controller.runRequest("a.example", task),
      controller.runRequest("a.example", task),
    ]);
    await vi.runAllTimersAsync();
    await all;

    expect(startTimes).toHaveLength(3);
    const gap1 = (startTimes[1] ?? 0) - (startTimes[0] ?? 0);
    const gap2 = (startTimes[2] ?? 0) - (startTimes[1] ?? 0);
    // random=0.2 → 10000 + 1000 / random=0.8 → 10000 + 4000
    expect(gap1).toBe(11_000);
    expect(gap2).toBe(14_000);
    // ジッターにより等間隔にならない
    expect(gap1).not.toBe(gap2);
    // すべて最小間隔以上
    expect(gap1).toBeGreaterThanOrEqual(10_000);
    expect(gap2).toBeGreaterThanOrEqual(10_000);
  });

  it("register429 で待機時間が予約され、以後の間隔が 2 倍になる（E10）", async () => {
    const controller = new PolitenessController(resolveCrawlerConfig(), {
      now: () => Date.now(),
      random: () => 0,
    });
    const startTimes: number[] = [];
    const task = (): Promise<void> => {
      startTimes.push(Date.now());
      return Promise.resolve();
    };

    const first = controller.runRequest("a.example", task);
    await vi.runAllTimersAsync();
    await first;

    // 1 回目の 429 → 60 秒待機を予約、リトライ許可
    expect(controller.register429("a.example", 60_000)).toBe(true);
    const second = controller.runRequest("a.example", task);
    await vi.runAllTimersAsync();
    await second;
    expect((startTimes[1] ?? 0) - (startTimes[0] ?? 0)).toBe(60_000);

    // 以後の間隔は 2 倍（20 秒 + ジッター 0）
    const third = controller.runRequest("a.example", task);
    await vi.runAllTimersAsync();
    await third;
    expect((startTimes[2] ?? 0) - (startTimes[1] ?? 0)).toBe(20_000);

    // 2 回目の 429 → 打ち切り
    expect(controller.register429("a.example", 60_000)).toBe(false);
    expect(controller.isAborted("a.example")).toBe(true);
    expect(controller.abortedHosts()).toEqual(["a.example"]);
  });

  it("別ドメインは間隔待ちなしで並行できる", async () => {
    const controller = new PolitenessController(resolveCrawlerConfig(), {
      now: () => Date.now(),
      random: () => 0,
    });
    const startTimes: number[] = [];
    const task = (): Promise<void> => {
      startTimes.push(Date.now());
      return Promise.resolve();
    };
    const all = Promise.all([
      controller.runRequest("a.example", task),
      controller.runRequest("b.example", task),
      controller.runRequest("c.example", task),
    ]);
    await vi.runAllTimersAsync();
    await all;
    expect(startTimes).toEqual([0, 0, 0]);
  });
});

describe("PolitenessController（実タイマー）", () => {
  it("同一ドメインは同時 1 接続に直列化される（E12）", async () => {
    const controller = new PolitenessController(
      resolveCrawlerConfig({ minDomainIntervalMs: 1, maxJitterMs: 0 }),
      realDeps,
    );
    let inFlight = 0;
    let maxInFlight = 0;
    const task = async (): Promise<void> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    };
    await Promise.all(
      Array.from({ length: 4 }, () => controller.runRequest("serial.example", task)),
    );
    expect(maxInFlight).toBe(1);
  });

  it("プロセス全体では同時 5 接続まで（別ドメインは並列可 — E12）", async () => {
    const controller = new PolitenessController(
      resolveCrawlerConfig({ minDomainIntervalMs: 1, maxJitterMs: 0 }),
      realDeps,
    );
    let inFlight = 0;
    let maxInFlight = 0;
    const task = async (): Promise<void> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
    };
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        controller.runRequest(`domain-${index}.example`, task),
      ),
    );
    expect(maxInFlight).toBe(5);
  });
});
