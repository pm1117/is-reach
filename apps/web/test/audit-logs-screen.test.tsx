// S9 監査ログ閲覧（管理者のみ — U9・閲覧専用）:
// - 非管理者の URL 直打ちは ForbiddenState
// - フィルタがクエリパラメータへ正しく反映される
// - 絞り込み 0 件の空状態 + フィルタクリア
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/lib/api/client";
import { buildAuditLogsPath, EMPTY_FILTER } from "@/features/audit/api";
import { AuditLogsScreen } from "@/features/audit/components/audit-logs-screen";
import AuditLogsPage from "@/app/(app)/audit-logs/page";
import { makeMe, withMeState, UUID_USER } from "./helpers";

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
const LOG_ID = "77777777-7777-4777-8777-777777777777";
const ISO = "2026-07-10T00:00:00.000Z";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

const USER = {
  id: UUID_USER,
  email: "user@example.com",
  displayName: "テスト担当者",
  role: "admin",
  invitationStatus: "active",
  createdAt: ISO,
};

const LOG_ENTRY = {
  id: LOG_ID,
  actorUserId: UUID_USER,
  eventType: "message.copied",
  resourceType: "Message",
  resourceId: LOG_ID,
  metadata: {},
  requestId: "req-log",
  occurredAt: ISO,
};

function auditLogCalls(fetchMock: ReturnType<typeof setupClient>): string[] {
  return fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.includes("/audit-logs?"));
}

describe("buildAuditLogsPath", () => {
  it("フィルタ未指定はページネーションのみ", () => {
    expect(buildAuditLogsPath(EMPTY_FILTER, 1)).toBe("/audit-logs?limit=50&offset=0");
    expect(buildAuditLogsPath(EMPTY_FILTER, 3)).toBe("/audit-logs?limit=50&offset=100");
  });

  it("期間は JST の日境界を UTC ISO へ変換して from/to に反映する", () => {
    const path = buildAuditLogsPath(
      { ...EMPTY_FILTER, fromDate: "2026-07-01", toDate: "2026-07-02" },
      1,
    );
    const params = new URLSearchParams(path.split("?")[1]);
    expect(params.get("from")).toBe("2026-06-30T15:00:00.000Z");
    expect(params.get("to")).toBe("2026-07-02T14:59:59.999Z");
  });

  it("イベント種別・ユーザーをクエリへ反映する", () => {
    const path = buildAuditLogsPath(
      { ...EMPTY_FILTER, eventType: "message.copied", actorUserId: UUID_USER },
      1,
    );
    const params = new URLSearchParams(path.split("?")[1]);
    expect(params.get("eventType")).toBe("message.copied");
    expect(params.get("actorUserId")).toBe(UUID_USER);
  });
});

describe("AuditLogsPage（S9）", () => {
  it("メンバーの URL 直打ちには ForbiddenState を表示し、画面本体を出さない", () => {
    setupClient(() => {
      throw new Error("非管理者では API を呼ばない想定");
    });
    render(
      withMeState({
        state: { status: "ready", me: makeMe("member") },
        children: <AuditLogsPage />,
      }),
    );

    expect(screen.getByText("この画面は管理者のみ利用できます")).toBeInTheDocument();
    expect(screen.queryByText("イベント種別")).toBeNull();
  });

  it("フィルタ変更が新しいクエリパラメータで再取得する", async () => {
    const fetchMock = setupClient((path) => {
      if (path.includes("/audit-logs?")) return jsonResponse({ items: [LOG_ENTRY], total: 1 });
      if (path.startsWith("/users?")) return jsonResponse({ items: [USER], total: 1 });
      throw new Error(`unexpected path: ${path}`);
    });
    render(<AuditLogsScreen />);

    // 初回はフィルタなし（イベント種別は表のセルに日本語ラベルで出る）
    expect(await screen.findByRole("cell", { name: "メッセージコピー" })).toBeInTheDocument();
    expect(auditLogCalls(fetchMock)[0]).toBe(`${BASE}/audit-logs?limit=50&offset=0`);

    // イベント種別で絞り込み
    await userEvent.selectOptions(screen.getByLabelText("イベント種別"), "message.copied");
    await waitFor(() => {
      expect(auditLogCalls(fetchMock).at(-1)).toContain("eventType=message.copied");
    });

    // ユーザーで絞り込み（選択肢は GET /users 由来）
    await userEvent.selectOptions(screen.getByLabelText("ユーザー"), UUID_USER);
    await waitFor(() => {
      expect(auditLogCalls(fetchMock).at(-1)).toContain(`actorUserId=${UUID_USER}`);
    });

    // 表示にはユーザー名（SafeText 経由）が出る
    expect(await screen.findByRole("cell", { name: "テスト担当者" })).toBeInTheDocument();
  });

  it("絞り込み 0 件は空状態 + フィルタクリアで解除できる", async () => {
    const fetchMock = setupClient((path) => {
      if (path.includes("/audit-logs?")) {
        // フィルタ付きは 0 件、なしは 1 件を返す
        return path.includes("eventType=")
          ? jsonResponse({ items: [], total: 0 })
          : jsonResponse({ items: [LOG_ENTRY], total: 1 });
      }
      if (path.startsWith("/users?")) return jsonResponse({ items: [USER], total: 1 });
      throw new Error(`unexpected path: ${path}`);
    });
    render(<AuditLogsScreen />);

    expect(await screen.findByRole("cell", { name: "メッセージコピー" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("イベント種別"), "user.login");
    expect(await screen.findByText("条件に一致するログがありません")).toBeInTheDocument();

    // フィルタクリアで全件へ戻る
    await userEvent.click(screen.getAllByRole("button", { name: "フィルタクリア" })[0]!);
    expect(await screen.findByRole("cell", { name: "メッセージコピー" })).toBeInTheDocument();
    await waitFor(() => {
      expect(auditLogCalls(fetchMock).at(-1)).toBe(`${BASE}/audit-logs?limit=50&offset=0`);
    });
  });
});
