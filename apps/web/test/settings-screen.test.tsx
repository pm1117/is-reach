// S8 テナント設定・ユーザー管理（管理者のみ — U9）:
// - 非管理者の URL 直打ちは ForbiddenState（既存 RequireAdmin ガードの画面レベル確認）
// - 招待モーダルが POST /users/invitations を正しい body で呼ぶ
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/lib/api/client";
import { ToastProvider } from "@/components/ui/toast";
import SettingsPage from "@/app/(app)/settings/page";
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
const OTHER_USER_ID = "66666666-6666-4666-8666-666666666666";
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

const SELF_USER = {
  id: UUID_USER,
  email: "user@example.com",
  displayName: "テスト担当者",
  role: "admin",
  invitationStatus: "active",
  createdAt: ISO,
};

const INVITED_USER = {
  id: OTHER_USER_ID,
  email: "new@example.com",
  displayName: null,
  role: "member",
  invitationStatus: "invited",
  createdAt: ISO,
};

describe("SettingsPage（S8）", () => {
  it("メンバーの URL 直打ちには ForbiddenState を表示し、画面本体を出さない", () => {
    setupClient(() => {
      throw new Error("非管理者では API を呼ばない想定");
    });
    render(
      withMeState({
        state: { status: "ready", me: makeMe("member") },
        children: (
          <ToastProvider>
            <SettingsPage />
          </ToastProvider>
        ),
      }),
    );

    expect(screen.getByText("この画面は管理者のみ利用できます")).toBeInTheDocument();
    expect(screen.queryByText("ユーザー管理")).toBeNull();
  });

  it("招待モーダルが POST /users/invitations を正しい body で呼ぶ", async () => {
    const fetchMock = setupClient((path, init) => {
      if (path.startsWith("/users?")) return jsonResponse({ items: [SELF_USER], total: 1 });
      if (path === "/users/invitations" && init?.method === "POST") {
        return jsonResponse(INVITED_USER, 201);
      }
      throw new Error(`unexpected path: ${path}`);
    });
    render(
      withMeState({
        state: { status: "ready", me: makeMe("admin") },
        children: (
          <ToastProvider>
            <SettingsPage />
          </ToastProvider>
        ),
      }),
    );

    await userEvent.click(await screen.findByRole("button", { name: "ユーザーを招待" }));
    await userEvent.type(screen.getByLabelText("メールアドレス"), "new@example.com");
    await userEvent.selectOptions(screen.getByLabelText("ロール"), "member");
    await userEvent.click(screen.getByRole("button", { name: "招待を送信" }));

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(postCall).toBeDefined();
    expect(String(postCall?.[0])).toBe(`${BASE}/users/invitations`);
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      email: "new@example.com",
      role: "member",
    });
  });

  it("データ削除依頼が確認モーダル経由で POST /deletion-requests を正しい body で呼ぶ", async () => {
    const ENTRY_ID = "88888888-8888-4888-8888-888888888888";
    const fetchMock = setupClient((path, init) => {
      if (path.startsWith("/users?")) return jsonResponse({ items: [SELF_USER], total: 1 });
      if (path === "/deletion-requests" && init?.method === "POST") {
        return jsonResponse({
          deleted: { dossiers: 1, messages: 2, collectedDocuments: 3, entries: 1 },
        });
      }
      throw new Error(`unexpected path: ${path}`);
    });
    render(
      withMeState({
        state: { status: "ready", me: makeMe("admin") },
        children: (
          <ToastProvider>
            <SettingsPage />
          </ToastProvider>
        ),
      }),
    );

    await userEvent.click(screen.getByRole("tab", { name: "データ削除依頼" }));
    await userEvent.type(screen.getByLabelText("対象エントリ ID（UUID）"), ENTRY_ID);
    await userEvent.type(
      screen.getByLabelText("削除理由（依頼の要旨 — 監査ログに記録されます）"),
      "本人からの削除依頼",
    );
    await userEvent.click(screen.getByRole("button", { name: "削除を実行" }));

    // 確認モーダル: 対象と「取り消し不可の物理削除」であることを明示する
    expect(await screen.findByText("この操作は取り消せません。")).toBeInTheDocument();
    expect(screen.getByText(ENTRY_ID)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "完全に削除する" }));

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(postCall).toBeDefined();
    expect(String(postCall?.[0])).toBe(`${BASE}/deletion-requests`);
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      scope: "entry",
      entryId: ENTRY_ID,
      reason: "本人からの削除依頼",
    });
    // 削除結果の件数表示
    expect(await screen.findByText("削除結果")).toBeInTheDocument();
  });

  it("削除範囲の切り替えで入力済みの対象 ID をクリアする（取り違え防止）", async () => {
    setupClient((path) => {
      if (path.startsWith("/users?")) return jsonResponse({ items: [SELF_USER], total: 1 });
      throw new Error(`unexpected path: ${path}`);
    });
    render(
      withMeState({
        state: { status: "ready", me: makeMe("admin") },
        children: (
          <ToastProvider>
            <SettingsPage />
          </ToastProvider>
        ),
      }),
    );

    await userEvent.click(screen.getByRole("tab", { name: "データ削除依頼" }));
    await userEvent.type(
      screen.getByLabelText("対象エントリ ID（UUID）"),
      "88888888-8888-4888-8888-888888888888",
    );
    await userEvent.selectOptions(screen.getByLabelText("削除範囲"), "company");
    expect(screen.getByLabelText("対象企業 ID（UUID）")).toHaveValue("");
  });

  it("自分自身の行には無効化ボタンとロール変更を出さない（誤操作防止）", async () => {
    setupClient((path) => {
      if (path.startsWith("/users?")) {
        return jsonResponse({
          items: [SELF_USER, { ...INVITED_USER, invitationStatus: "active" }],
          total: 2,
        });
      }
      throw new Error(`unexpected path: ${path}`);
    });
    render(
      withMeState({
        state: { status: "ready", me: makeMe("admin") },
        children: (
          <ToastProvider>
            <SettingsPage />
          </ToastProvider>
        ),
      }),
    );

    expect(await screen.findByText("new@example.com")).toBeInTheDocument();
    // 他ユーザーの行のみ操作可能（無効化ボタンは 1 つ）
    expect(screen.getAllByRole("button", { name: "無効化" })).toHaveLength(1);
    expect(screen.getByText("(自分)")).toBeInTheDocument();
  });
});
