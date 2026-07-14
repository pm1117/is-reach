// S1 ダッシュボード（3 ブロック簡易版 — 決定 U2）:
// - 1 ブロックの取得エラーが他ブロックの表示を壊さない（ui-spec 4.3 — 領域単位 ErrorState）
// - リスト 0 件時は各ブロックが空状態 + スクリーニング導線
// - 実行中ジョブの列挙とステータス集計
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/lib/api/client";
import { DashboardScreen } from "@/features/dashboard/components/dashboard-screen";

const { getBrowserApiClientMock } = vi.hoisted(() => ({
  getBrowserApiClientMock: vi.fn(),
}));
vi.mock("@/lib/api/browser", () => ({ getBrowserApiClient: getBrowserApiClientMock }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <span data-href={href} {...rest}>
      {children}
    </span>
  ),
}));

const BASE = "http://api.test";
const LIST_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";
const ENTRY_ID_2 = "22222222-2222-4222-8222-222222222223";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const COMPANY_ID = "44444444-4444-4444-8444-444444444444";
const ISO = "2026-07-10T00:00:00.000Z";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(requestId: string, status = 500): Response {
  return jsonResponse(
    { error: { code: "INTERNAL", message: "サーバーエラー", requestId } },
    status,
  );
}

function setupClient(handler: (path: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input).slice(BASE.length), init),
  );
  getBrowserApiClientMock.mockReturnValue(
    new ApiClient({
      baseUrl: BASE,
      getAccessToken: async () => null,
      fetchFn: fetchMock as unknown as typeof fetch,
    }),
  );
  return fetchMock;
}

function makeList(name: string) {
  return {
    id: LIST_ID,
    name,
    searchCondition: {},
    createdBy: null,
    createdAt: ISO,
  };
}

function makeEntry(id: string, status: string, latestDeepDiveJobId: string | null) {
  return {
    id,
    companyListId: LIST_ID,
    company: {
      id: COMPANY_ID,
      name: "株式会社サンプル",
      domain: null,
      industry: null,
      employeeRange: null,
      region: null,
    },
    matchEvidence: [],
    status,
    assigneeId: null,
    latestDeepDiveJobId,
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function makeJob(state: string) {
  return {
    id: JOB_ID,
    listEntryId: ENTRY_ID,
    state,
    progress: { fetchedPages: 1, plannedPages: null },
    partialFailures: [],
    error: null,
    attempts: 1,
    createdAt: ISO,
    updatedAt: ISO,
  };
}

describe("DashboardScreen", () => {
  it("合成取得（ジョブ・集計）が失敗しても「最近のリスト」ブロックの表示を壊さない", async () => {
    setupClient((path) => {
      if (path.startsWith("/lists?limit=5")) {
        return jsonResponse({ items: [makeList("PR6b テストリスト")], total: 1 });
      }
      if (path.startsWith("/lists?limit=3")) {
        return errorResponse("req-activity");
      }
      throw new Error(`unexpected path: ${path}`);
    });
    render(<DashboardScreen />);

    // 最近のリストは正常表示
    expect(await screen.findByText("PR6b テストリスト")).toBeInTheDocument();
    // ジョブ・集計の 2 ブロックは領域単位の ErrorState（画面全体は壊れない）
    await waitFor(() => {
      expect(screen.getAllByText("読み込みに失敗しました")).toHaveLength(2);
    });
    expect(screen.getAllByText("参照 ID: req-activity")).toHaveLength(2);
    expect(screen.getByText("最近のリスト")).toBeInTheDocument();
  });

  it("逆に「最近のリスト」が失敗してもジョブ・集計ブロックは表示される", async () => {
    setupClient((path) => {
      if (path.startsWith("/lists?limit=5")) return errorResponse("req-recent");
      if (path.startsWith("/lists?limit=3")) return jsonResponse({ items: [], total: 0 });
      throw new Error(`unexpected path: ${path}`);
    });
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getAllByText("読み込みに失敗しました")).toHaveLength(1);
    });
    expect(screen.getByText("参照 ID: req-recent")).toBeInTheDocument();
    // 集計・ジョブブロックはリスト 0 件の空状態として正常表示
    expect(screen.getAllByText("まだリストがありません").length).toBeGreaterThanOrEqual(2);
  });

  it("リスト 0 件時は各ブロックが空状態 + スクリーニングへの導線を出す", async () => {
    setupClient((path) => {
      if (path.startsWith("/lists?")) return jsonResponse({ items: [], total: 0 });
      throw new Error(`unexpected path: ${path}`);
    });
    render(<DashboardScreen />);

    const titles = await screen.findAllByText("まだリストがありません");
    expect(titles).toHaveLength(3);
    expect(screen.getAllByText("スクリーニング検索へ").length).toBe(3);
  });

  it("実行中の深掘りジョブを列挙し、エントリのステータスを集計する", async () => {
    setupClient((path) => {
      if (path.startsWith("/lists?")) {
        return jsonResponse({ items: [makeList("進行中リスト")], total: 1 });
      }
      if (path.startsWith(`/lists/${LIST_ID}/entries`)) {
        return jsonResponse({
          items: [
            makeEntry(ENTRY_ID, "not_started", JOB_ID),
            makeEntry(ENTRY_ID_2, "generated", null),
          ],
          total: 2,
        });
      }
      if (path === `/deep-dive-jobs/${JOB_ID}`) return jsonResponse(makeJob("collecting"));
      throw new Error(`unexpected path: ${path}`);
    });
    render(<DashboardScreen />);

    // 実行中ジョブ: 企業名 + 状態バッジ + リストへのリンク
    expect(await screen.findByText("収集中")).toBeInTheDocument();
    expect(screen.getByText("株式会社サンプル")).toBeInTheDocument();
    expect(screen.getByText("リストを開く")).toBeInTheDocument();
    // ステータス集計（未着手 1 / 生成済み 1）と対象範囲の注記
    expect(screen.getByText("未着手")).toBeInTheDocument();
    expect(screen.getByText("生成済み")).toBeInTheDocument();
    expect(
      screen.getByText("集計対象は直近 1 件のリストのエントリ（各リスト最大 200 件）のみです"),
    ).toBeInTheDocument();
  });
});
