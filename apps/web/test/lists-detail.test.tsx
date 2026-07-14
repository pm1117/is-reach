// S4 リスト詳細（pr-plan PR6b テスト観点）:
// - 深掘り failed 行に「再実行」導線があり、押下で retry API が呼ばれる
// - ポーリングが全ジョブ終了で停止する（画面レベル・fake timers）
// - ステータスのインライン更新が PATCH /entries/:entryId を呼ぶ
// - 選択実行が POST /deep-dive-jobs に entryIds を渡し、202 応答で即時反映される
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { ListDetailPage } from "@/features/lists/components/list-detail-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    // テスト用スタブ（next/link の代替。素の <a> 禁止 lint の対象外にするため）
    <span data-href={href} {...rest}>
      {children}
    </span>
  ),
}));

const fetchMock = vi.fn<typeof fetch>();
vi.mock("@/lib/api/browser", async () => {
  const { ApiClient } = await import("@/lib/api/client");
  // 実装同様シングルトンにする（毎回 new すると useCallback の deps が変わり再取得ループになる）
  const client = new ApiClient({
    baseUrl: "http://api.test/api/v1",
    getAccessToken: async () => "test-token",
    fetchFn: (input, init) => fetchMock(input, init),
  });
  return { getBrowserApiClient: () => client };
});

const LIST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ENTRY_1 = "11111111-1111-4111-8111-111111111111";
const COMPANY_1 = "22222222-2222-4222-8222-222222222222";
const JOB_1 = "33333333-3333-4333-8333-333333333333";
const SIGNAL_1 = "44444444-4444-4444-8444-444444444444";

const LIST = {
  id: LIST_ID,
  name: "7月リスト",
  searchCondition: { limit: 200 },
  createdBy: null,
  createdAt: "2026-07-10T03:00:00.000Z",
};

function makeEntry(overrides: { latestDeepDiveJobId: string | null; status?: string }) {
  return {
    id: ENTRY_1,
    companyListId: LIST_ID,
    company: {
      id: COMPANY_1,
      name: "株式会社ガンマ",
      domain: null,
      industry: "SaaS",
      employeeRange: "51-200",
      region: "東京都",
    },
    matchEvidence: [
      {
        signalId: SIGNAL_1,
        kind: "job_posting",
        summary: "React エンジニア募集",
        sourceUrl: "https://example.com/jobs/1",
        collectedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    status: overrides.status ?? "not_started",
    assigneeId: null,
    latestDeepDiveJobId: overrides.latestDeepDiveJobId,
    createdAt: "2026-07-10T03:00:00.000Z",
    updatedAt: "2026-07-10T03:00:00.000Z",
  };
}

function makeJob(
  state: "queued" | "collecting" | "analyzing" | "done" | "failed",
  error: { code: string; message: string } | null = null,
) {
  return {
    id: JOB_1,
    listEntryId: ENTRY_1,
    state,
    progress: { fetchedPages: 0, plannedPages: null },
    partialFailures: [],
    error,
    attempts: 1,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:05:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function callsOf(method: string, pathname: string) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const url = new URL(requestUrl(input));
    return (init?.method ?? "GET") === method && url.pathname === pathname;
  });
}

interface FetchHandlers {
  entries: () => unknown;
  job?: () => unknown;
  retry?: () => unknown;
  patchEntry?: (body: unknown) => unknown;
  createJobs?: (body: unknown) => unknown;
}

function setupFetch(handlers: FetchHandlers) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(requestUrl(input));
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    switch (key) {
      case `GET /api/v1/lists/${LIST_ID}`:
        return jsonResponse(LIST);
      case `GET /api/v1/lists/${LIST_ID}/entries`:
        return jsonResponse(handlers.entries());
      case `GET /api/v1/deep-dive-jobs/${JOB_1}`:
        if (handlers.job === undefined) break;
        return jsonResponse(handlers.job());
      case `POST /api/v1/deep-dive-jobs/${JOB_1}/retry`:
        if (handlers.retry === undefined) break;
        return jsonResponse(handlers.retry(), 202);
      case `PATCH /api/v1/entries/${ENTRY_1}`:
        if (handlers.patchEntry === undefined) break;
        return jsonResponse(handlers.patchEntry(JSON.parse(String(init?.body))));
      case "POST /api/v1/deep-dive-jobs":
        if (handlers.createJobs === undefined) break;
        return jsonResponse(handlers.createJobs(JSON.parse(String(init?.body))), 202);
      default:
        break;
    }
    throw new Error(`予期しないリクエスト: ${key}`);
  });
}

function renderPage() {
  return render(
    <ToastProvider>
      <ListDetailPage listId={LIST_ID} />
    </ToastProvider>,
  );
}

describe("ListDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("リスト 0 社は空状態を表示する", async () => {
    setupFetch({ entries: () => ({ items: [], total: 0 }) });
    renderPage();
    expect(await screen.findByText("このリストに企業がありません")).toBeInTheDocument();
    // パンくず「リスト > {リスト名}」
    expect(screen.getByText("リスト")).toHaveAttribute("data-href", "/lists");
  });

  it("深掘り failed 行に「再実行」導線があり、押下で retry API が呼ばれ queued へ即時反映される", async () => {
    let retried = false;
    setupFetch({
      entries: () => ({ items: [makeEntry({ latestDeepDiveJobId: JOB_1 })], total: 1 }),
      job: () =>
        retried
          ? makeJob("queued")
          : makeJob("failed", {
              code: "CRAWL_ALL_FAILED",
              message: "全ページの取得に失敗しました",
            }),
      retry: () => {
        retried = true;
        return makeJob("queued");
      },
    });
    renderPage();

    // 絞り込みセレクトにも「失敗」等の文言があるため、テーブル内で検証する
    const table = within(await screen.findByRole("table"));
    expect(await table.findByText("失敗")).toBeInTheDocument();
    // 失敗理由の要約（ジョブ由来 = SafeText 表示）
    expect(table.getByText("全ページの取得に失敗しました")).toBeInTheDocument();

    fireEvent.click(table.getByRole("button", { name: "再実行" }));
    await waitFor(() => {
      expect(callsOf("POST", `/api/v1/deep-dive-jobs/${JOB_1}/retry`)).toHaveLength(1);
    });
    expect(await table.findByText("待機中")).toBeInTheDocument();
  });

  it("実行中ジョブを 10 秒間隔でポーリングし、全件終了で停止してエントリを再取得する", async () => {
    vi.useFakeTimers();
    let jobFetchCount = 0;
    setupFetch({
      entries: () => ({ items: [makeEntry({ latestDeepDiveJobId: JOB_1 })], total: 1 }),
      job: () => {
        jobFetchCount += 1;
        // 初回取得は収集中、以降（ポーリング）は完了
        return jobFetchCount === 1 ? makeJob("collecting") : makeJob("done");
      },
    });
    renderPage();

    // 初回ロード（リスト・エントリ・ジョブ状態）を反映
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const table = () => within(screen.getByRole("table"));
    expect(table().getByText("収集中")).toBeInTheDocument();
    expect(table().getByText("公開情報を収集しています")).toBeInTheDocument();
    expect(screen.getByText("深掘り実行中: 1 社")).toBeInTheDocument();
    const entriesPath = `/api/v1/lists/${LIST_ID}/entries`;
    expect(callsOf("GET", entriesPath)).toHaveLength(1);

    // 1 周期（10 秒）でポーリングが走り done へ遷移 → エントリ一覧も再取得される
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(table().getByText("完了")).toBeInTheDocument();
    expect(screen.queryByText("深掘り実行中: 1 社")).toBeNull();
    expect(callsOf("GET", entriesPath).length).toBeGreaterThanOrEqual(2);

    // 全ジョブ終了後はポーリングが停止する（ジョブ取得回数が増えない）
    const stabilizedJobFetches = callsOf("GET", `/api/v1/deep-dive-jobs/${JOB_1}`).length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(callsOf("GET", `/api/v1/deep-dive-jobs/${JOB_1}`)).toHaveLength(stabilizedJobFetches);

    vi.useRealTimers();
  });

  it("ステータスのインライン更新が PATCH /entries/:entryId を呼ぶ", async () => {
    setupFetch({
      entries: () => ({ items: [makeEntry({ latestDeepDiveJobId: null })], total: 1 }),
      patchEntry: (body) => {
        const parsed = body as { status: string };
        return makeEntry({ latestDeepDiveJobId: null, status: parsed.status });
      },
    });
    renderPage();

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("未実行")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("株式会社ガンマ のステータス"), {
      target: { value: "sent" },
    });

    await waitFor(() => {
      expect(callsOf("PATCH", `/api/v1/entries/${ENTRY_1}`)).toHaveLength(1);
    });
    const [call] = callsOf("PATCH", `/api/v1/entries/${ENTRY_1}`);
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ status: "sent" });
    await waitFor(() => {
      expect(screen.getByLabelText("株式会社ガンマ のステータス")).toHaveValue("sent");
    });
  });

  it("選択実行が POST /deep-dive-jobs に entryIds を渡し、202 応答の jobs で即時反映される", async () => {
    setupFetch({
      entries: () => ({ items: [makeEntry({ latestDeepDiveJobId: null })], total: 1 }),
      createJobs: () => ({ jobs: [makeJob("queued")] }),
    });
    renderPage();

    await screen.findByText("株式会社ガンマ");
    const runButton = screen.getByRole("button", { name: /選択した企業を深掘り/ });
    expect(runButton).toBeDisabled();

    fireEvent.click(screen.getByLabelText("株式会社ガンマ を選択"));
    expect(runButton).toBeEnabled();
    fireEvent.click(runButton);

    // 確認モーダル → 実行
    fireEvent.click(await screen.findByRole("button", { name: "実行する" }));
    await waitFor(() => {
      expect(callsOf("POST", "/api/v1/deep-dive-jobs")).toHaveLength(1);
    });
    const [call] = callsOf("POST", "/api/v1/deep-dive-jobs");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ entryIds: [ENTRY_1] });

    // エントリ再取得を待たずに深掘り状態列が queued（待機中）になる
    expect(await screen.findByText("待機中")).toBeInTheDocument();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
