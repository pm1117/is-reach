// 同時実行制御の小さなプリミティブ。外部依存を増やさないため自前実装する
// （必要なのは Mutex / Semaphore / sleep のみで、ライブラリを入れるほどの規模ではない）。

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ドメイン単位の直列化（E12: 同一ドメイン同時 1 接続）に使う Mutex */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  /** 先行タスクの完了（成否問わず）を待ってから task を実行する */
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    // 後続の連鎖は task の失敗に巻き込まない
    this.tail = next.catch(() => undefined);
    return next;
  }
}

/** プロセス全体の同時接続数上限（E12: 5）に使うカウンティングセマフォ */
export class Semaphore {
  private available: number;
  private readonly waiters: (() => void)[] = [];

  constructor(count: number) {
    if (!Number.isInteger(count) || count < 1) {
      throw new RangeError(`Semaphore のスロット数は 1 以上の整数が必要: ${count}`);
    }
    this.available = count;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      next();
    } else {
      this.available += 1;
    }
  }
}
