// 1 リクエスト分の低レベル HTTP GET。
// - リダイレクトは追わない（redirect: "manual"。分類・追従は呼び出し側 = page-fetcher / robots）
// - タイムアウト（E12: 15 秒）は接続から本文読み切りまでを 1 つの AbortController で覆う
// - 本文は 2xx のときだけ読み、上限（E12: 2MB）を超えたら打ち切って tooLarge を立てる

export type RawFetchResult =
  | {
      kind: "response";
      status: number;
      headers: Headers;
      /** 2xx かつ上限内のときのみ本文テキスト。それ以外は null */
      bodyText: string | null;
      /** Content-Length またはストリーム読み取りで本文上限を超えた */
      tooLarge: boolean;
    }
  | { kind: "timeout" }
  | { kind: "connection_error" };

export interface RawGetOptions {
  fetchImpl: typeof fetch;
  userAgent: string;
  timeoutMs: number;
  maxBodyBytes: number;
}

export async function rawGet(url: string, options: RawGetOptions): Promise<RawFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let response: Response;
    try {
      response = await options.fetchImpl(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": options.userAgent,
          accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        },
      });
    } catch {
      // DNS 不能・接続拒否・TLS エラー等は fetch が例外を投げる。
      // タイムアウトによる中断かどうかは signal で判別する（エラー型には依存しない）
      return controller.signal.aborted ? { kind: "timeout" } : { kind: "connection_error" };
    }

    if (response.status >= 200 && response.status < 300) {
      const contentLength = response.headers.get("content-length");
      if (contentLength !== null) {
        const declared = Number(contentLength);
        if (Number.isFinite(declared) && declared > options.maxBodyBytes) {
          await discardBody(response);
          return {
            kind: "response",
            status: response.status,
            headers: response.headers,
            bodyText: null,
            tooLarge: true,
          };
        }
      }
      try {
        const body = await readBodyWithCap(response, options.maxBodyBytes);
        return {
          kind: "response",
          status: response.status,
          headers: response.headers,
          bodyText: body.tooLarge ? null : body.text,
          tooLarge: body.tooLarge,
        };
      } catch {
        // 本文読み取り中の中断・切断
        return controller.signal.aborted ? { kind: "timeout" } : { kind: "connection_error" };
      }
    }

    await discardBody(response);
    return {
      kind: "response",
      status: response.status,
      headers: response.headers,
      bodyText: null,
      tooLarge: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 本文をバイト上限つきで読み UTF-8 として復号する（上限超過時点で読み取りを打ち切る） */
async function readBodyWithCap(
  response: Response,
  maxBytes: number,
): Promise<{ tooLarge: boolean; text: string }> {
  const body = response.body;
  if (body === null) {
    return { tooLarge: false, text: "" };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { tooLarge: true, text: "" };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // 文字コードは UTF-8 前提で非厳格に復号する（charset 判定は MVP では行わない）
  return { tooLarge: false, text: new TextDecoder("utf-8", { fatal: false }).decode(merged) };
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 破棄の失敗は無視してよい
  }
}
