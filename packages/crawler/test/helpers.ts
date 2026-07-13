// テスト用の fetch スタブ。実ネットワークには一切出ない（PR2 の品質要件）。
export interface RecordedCall {
  url: string;
  /** 呼び出し時刻（fake timers 使用時は仮想時刻） */
  timeMs: number;
}

export interface StubCallContext {
  url: URL;
  /** 同一 URL に対する何回目の呼び出しか（0 始まり） */
  callIndexForUrl: number;
  init: RequestInit | undefined;
}

/** "hang" を返すと signal が abort されるまで解決しないリクエストになる（タイムアウト試験用） */
export type StubHandler = (context: StubCallContext) => Response | Promise<Response> | "hang";

export interface StubFetch {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
  callsTo(url: string): RecordedCall[];
  maxInFlight(): number;
}

export function createStubFetch(handler: StubHandler): StubFetch {
  const calls: RecordedCall[] = [];
  const countByUrl = new Map<string, number>();
  let inFlight = 0;
  let maxInFlight = 0;

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const callIndexForUrl = countByUrl.get(url.href) ?? 0;
    countByUrl.set(url.href, callIndexForUrl + 1);
    calls.push({ url: url.href, timeMs: Date.now() });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const result = await handler({ url, callIndexForUrl, init });
      if (result === "hang") {
        return await hangUntilAborted(init?.signal);
      }
      return result;
    } finally {
      inFlight -= 1;
    }
  }) as typeof fetch;

  return {
    fetchImpl,
    calls,
    callsTo: (url: string) => calls.filter((call) => call.url === url),
    maxInFlight: () => maxInFlight,
  };
}

function hangUntilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    if (signal == null) return; // signal がなければ永遠に保留（テストでは必ず signal が来る想定）
    const abort = (): void => {
      reject(makeAbortError());
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function makeAbortError(): Error {
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  return error;
}

export function htmlResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
}

export function robotsOk(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/plain" } });
}

export function notFound(): Response {
  return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
}

export function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** robots.txt は 404（= 全許可）、それ以外は route に委譲する標準ハンドラ */
export function withRobots404(route: StubHandler): StubHandler {
  return (context) => {
    if (context.url.pathname === "/robots.txt") return notFound();
    return route(context);
  };
}

/** 高速テスト用の節度設定（タイミング検証をしないテストで使う） */
export const FAST_CONFIG = {
  minDomainIntervalMs: 1,
  maxJitterMs: 0,
  pageTimeoutMs: 5_000,
  http429MinWaitMs: 1,
  http5xxRetryWaitMs: 1,
} as const;
