// S3 リスト一覧（pr-plan PR6b テスト観点）:
// - 空状態文言（ui-spec 4.2 の表どおり）+ スクリーニング検索への導線
// - リスト名変更（PATCH）・削除（DELETE。権限は全員 — design-detail 2.2）
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { ListsPage } from "@/features/lists/components/lists-page";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
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

const LIST = {
  id: LIST_ID,
  name: "7月リスト",
  searchCondition: { limit: 200 },
  createdBy: null,
  createdAt: "2026-07-10T03:00:00.000Z",
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

function callsOf(method: string, pathname: string) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const url = new URL(requestUrl(input));
    return (init?.method ?? "GET") === method && url.pathname === pathname;
  });
}

function setupFetch(lists: { items: unknown[]; total: number }) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(requestUrl(input));
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    switch (key) {
      case "GET /api/v1/lists":
        return jsonResponse(lists);
      case `PATCH /api/v1/lists/${LIST_ID}`: {
        const body = JSON.parse(String(init?.body)) as { name: string };
        return jsonResponse({ ...LIST, name: body.name });
      }
      case `DELETE /api/v1/lists/${LIST_ID}`:
        return new Response(null, { status: 204 });
      default:
        throw new Error(`予期しないリクエスト: ${key}`);
    }
  });
}

function renderPage() {
  return render(
    <ToastProvider>
      <ListsPage />
    </ToastProvider>,
  );
}

describe("ListsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("リスト 0 件は空状態文言 + スクリーニング検索への導線を表示する（ui-spec 4.2）", async () => {
    setupFetch({ items: [], total: 0 });
    renderPage();

    expect(
      await screen.findByText(
        "まだリストがありません。スクリーニング検索から企業を抽出して保存しましょう",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "スクリーニング検索へ" }));
    expect(routerPush).toHaveBeenCalledWith("/screening");
  });

  it("リスト名・作成日時（JST）を表示し、リスト名は詳細への遷移リンクになる", async () => {
    setupFetch({ items: [LIST], total: 1 });
    renderPage();

    const nameLink = await screen.findByText("7月リスト");
    expect(nameLink).toHaveAttribute("data-href", `/lists/${LIST_ID}`);
    // 2026-07-10T03:00:00Z = JST 12:00
    expect(screen.getByText("2026-07-10 12:00")).toBeInTheDocument();
  });

  it("名前変更モーダルで保存すると PATCH /lists/:listId が呼ばれる", async () => {
    setupFetch({ items: [LIST], total: 1 });
    renderPage();
    await screen.findByText("7月リスト");

    fireEvent.click(screen.getByRole("button", { name: "名前を変更" }));
    const input = screen.getByLabelText("リスト名");
    expect(input).toHaveValue("7月リスト");
    fireEvent.change(input, { target: { value: "8月リスト" } });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));

    await waitFor(() => {
      expect(callsOf("PATCH", `/api/v1/lists/${LIST_ID}`)).toHaveLength(1);
    });
    const [call] = callsOf("PATCH", `/api/v1/lists/${LIST_ID}`);
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ name: "8月リスト" });
  });

  it("削除は danger 確認モーダルを経て DELETE /lists/:listId を呼ぶ", async () => {
    setupFetch({ items: [LIST], total: 1 });
    renderPage();
    await screen.findByText("7月リスト");

    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByText(/この操作は取り消せません/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));

    await waitFor(() => {
      expect(callsOf("DELETE", `/api/v1/lists/${LIST_ID}`)).toHaveLength(1);
    });
  });
});
