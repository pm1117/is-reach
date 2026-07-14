// S2 スクリーニング検索（pr-plan PR6b テスト観点）:
// - 検索 → 結果表示。マッチ根拠の summary が HTML として解釈されない（SafeText — ui-spec 7 章）
// - 「リストとして保存」で選択した companyIds と検索条件スナップショットが POST /lists に渡る
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { ScreeningSearchPage } from "@/features/screening/components/screening-search-page";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
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

const COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SIGNAL_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LIST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const FACETS = {
  industries: ["SaaS", "製造"],
  employeeRanges: ["51-200"],
  regions: ["東京都"],
  signalKinds: ["job_posting", "tech_blog", "press_release"],
};

/** スクレイピング由来の要約に HTML が混入したケース（プレーンテキスト表示の検証用） */
const XSS_SUMMARY = '<img src="x" onerror="alert(1)">React エンジニア募集';

const SEARCH_RESPONSE = {
  results: [
    {
      company: {
        id: COMPANY_A,
        name: "株式会社アルファ",
        domain: "alpha.example.com",
        industry: "SaaS",
        employeeRange: "51-200",
        region: "東京都",
      },
      score: 10,
      matchedSignals: [
        {
          signalId: SIGNAL_1,
          kind: "job_posting",
          summary: XSS_SUMMARY,
          sourceUrl: "https://example.com/jobs/1",
          collectedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    },
    {
      company: {
        id: COMPANY_B,
        name: "株式会社ベータ",
        domain: null,
        industry: null,
        employeeRange: null,
        region: null,
      },
      score: 5,
      matchedSignals: [],
    },
  ],
  total: 2,
};

const CREATED_LIST = {
  id: LIST_ID,
  name: "7月ターゲット",
  searchCondition: { limit: 200 },
  createdBy: null,
  createdAt: "2026-07-14T00:00:00.000Z",
};

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

/** 指定 method + パスへの呼び出しの JSON ボディ一覧 */
function bodiesOf(method: string, pathname: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => {
      const url = new URL(requestUrl(input));
      return (init?.method ?? "GET") === method && url.pathname === pathname;
    })
    .map(([, init]) => JSON.parse(String(init?.body)) as unknown);
}

function setupFetch() {
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(requestUrl(input));
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    switch (key) {
      case "GET /api/v1/screening/facets":
        return jsonResponse(FACETS);
      case "POST /api/v1/screening/searches":
        return jsonResponse(SEARCH_RESPONSE);
      case "POST /api/v1/lists":
        return jsonResponse(CREATED_LIST, 201);
      default:
        throw new Error(`予期しないリクエスト: ${key}`);
    }
  });
}

function renderPage() {
  return render(
    <ToastProvider>
      <ScreeningSearchPage />
    </ToastProvider>,
  );
}

async function runSearchWithSaasIndustry() {
  renderPage();
  fireEvent.click(await screen.findByLabelText("SaaS"));
  fireEvent.click(screen.getByRole("button", { name: "検索する" }));
  await screen.findByText("株式会社アルファ");
}

describe("ScreeningSearchPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFetch();
  });

  it("検索前は空状態を表示し、検索で条件が POST され結果テーブルが表示される", async () => {
    renderPage();
    expect(
      await screen.findByText("検索条件を指定して「検索する」を押してください"),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByLabelText("SaaS"));
    fireEvent.click(screen.getByRole("button", { name: "検索する" }));

    expect(await screen.findByText("株式会社アルファ")).toBeInTheDocument();
    expect(screen.getByText("株式会社ベータ")).toBeInTheDocument();
    expect(screen.getByText("該当 2 社（選択中 2 社）")).toBeInTheDocument();

    const [searchBody] = bodiesOf("POST", "/api/v1/screening/searches");
    expect(searchBody).toEqual({
      attributes: { industries: ["SaaS"] },
      limit: 200,
    });
  });

  it("マッチ根拠の summary は HTML として解釈されずプレーンテキスト表示される（SafeText）", async () => {
    await runSearchWithSaasIndustry();

    // シグナル種別バッジ + 要約（左パネルの facet チェックボックスと区別するためテーブル内で検証）
    const table = within(screen.getByRole("table"));
    expect(table.getByText("求人")).toBeInTheDocument();
    expect(table.getByText(XSS_SUMMARY)).toBeInTheDocument();
    // HTML が注入されていない（<img> 要素が生成されない）
    expect(document.querySelector("img")).toBeNull();

    // 根拠詳細の展開で出典 URL が ExternalLink（rel/target 付き）で表示される
    fireEvent.click(table.getByRole("button", { name: "根拠詳細 (1)" }));
    const link = table.getByRole("link", { name: /example\.com/ });
    expect(link).toHaveAttribute("href", "https://example.com/jobs/1");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("リストとして保存: 選択した companyIds と検索条件スナップショットが POST /lists に渡り、作成先へ遷移する", async () => {
    await runSearchWithSaasIndustry();

    // 既定は全選択 → ベータ社を除外
    fireEvent.click(screen.getByLabelText("株式会社ベータ を選択"));
    expect(screen.getByText("該当 2 社（選択中 1 社）")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /リストとして保存/ }));
    fireEvent.change(screen.getByLabelText("リスト名"), {
      target: { value: "7月ターゲット" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));

    await waitFor(() => {
      expect(bodiesOf("POST", "/api/v1/lists")).toHaveLength(1);
    });
    const [createBody] = bodiesOf("POST", "/api/v1/lists");
    expect(createBody).toEqual({
      name: "7月ターゲット",
      // 直前の検索リクエストと同じ条件スナップショット（要件 F1 受け入れ条件 1）
      searchCondition: { attributes: { industries: ["SaaS"] }, limit: 200 },
      companyIds: [COMPANY_A],
    });
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith(`/lists/${LIST_ID}`);
    });
  });

  it("結果 0 件は空状態を表示する", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(requestUrl(input));
      const key = `${init?.method ?? "GET"} ${url.pathname}`;
      if (key === "GET /api/v1/screening/facets") return jsonResponse(FACETS);
      if (key === "POST /api/v1/screening/searches") return jsonResponse({ results: [], total: 0 });
      throw new Error(`予期しないリクエスト: ${key}`);
    });
    renderPage();
    fireEvent.click(await screen.findByLabelText("SaaS"));
    fireEvent.click(screen.getByRole("button", { name: "検索する" }));
    expect(await screen.findByText("条件に一致する企業がありません")).toBeInTheDocument();
  });
});
