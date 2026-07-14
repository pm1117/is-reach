// S7 テンプレート管理（要件 F4 / 決定 E3 / ui-spec 8 章 — U9）:
// - メンバーには作成・編集・削除ボタンを一切表示しない（disabled ではなく非表示）
// - 空状態はロール別文言（ui-spec 4.2）
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "@is-reach/shared";
import { ApiClient } from "@/lib/api/client";
import { ToastProvider } from "@/components/ui/toast";
import { TemplatesScreen } from "@/features/templates/components/templates-screen";
import { makeMe, withMeState, UUID_USER } from "./helpers";

const { getBrowserApiClientMock } = vi.hoisted(() => ({
  getBrowserApiClientMock: vi.fn(),
}));
vi.mock("@/lib/api/browser", () => ({ getBrowserApiClient: getBrowserApiClientMock }));

const BASE = "http://api.test";
const TEMPLATE_ID = "55555555-5555-4555-8555-555555555555";
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

const TEMPLATE = {
  id: TEMPLATE_ID,
  name: "初回接触テンプレ",
  introduction: "私たちは営業支援 SaaS を提供しています。",
  cta: "15 分のオンライン打ち合わせはいかがでしょうか。",
  tone: "丁寧",
  maxLength: 400,
  createdBy: UUID_USER,
  updatedAt: ISO,
};

function setupTemplates(items: ReadonlyArray<unknown>) {
  return setupClient((path) => {
    if (path.startsWith("/templates?")) return jsonResponse({ items, total: items.length });
    if (path.startsWith("/users?")) return jsonResponse({ items: [], total: 0 });
    throw new Error(`unexpected path: ${path}`);
  });
}

function renderScreen(role: Role) {
  render(
    withMeState({
      state: { status: "ready", me: makeMe(role) },
      children: (
        <ToastProvider>
          <TemplatesScreen />
        </ToastProvider>
      ),
    }),
  );
}

describe("TemplatesScreen", () => {
  it("メンバーには作成・編集・削除ボタンを表示しない（非表示 — disabled ではない）", async () => {
    setupTemplates([TEMPLATE]);
    renderScreen("member");

    // 一覧の行を選択して詳細を表示
    await userEvent.click(await screen.findByText("初回接触テンプレ"));
    expect(await screen.findByText("私たちは営業支援 SaaS を提供しています。")).toBeInTheDocument();

    // ボタンは DOM に存在しない（disabled で置かれてもいない — U9）
    expect(screen.queryByRole("button", { name: "新規作成" })).toBeNull();
    expect(screen.queryByRole("button", { name: "編集" })).toBeNull();
    expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
  });

  it("管理者には新規作成・編集・削除ボタンを表示する", async () => {
    setupTemplates([TEMPLATE]);
    renderScreen("admin");

    expect(await screen.findByRole("button", { name: "新規作成" })).toBeInTheDocument();
    await userEvent.click(screen.getByText("初回接触テンプレ"));
    expect(await screen.findByRole("button", { name: "編集" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
  });

  it("空状態（メンバー）: 依頼文言のみで作成導線を出さない", async () => {
    setupTemplates([]);
    renderScreen("member");

    expect(
      await screen.findByText("利用できるテンプレートがありません。管理者に作成を依頼してください"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "テンプレートを作成" })).toBeNull();
    expect(screen.queryByRole("button", { name: "新規作成" })).toBeNull();
  });

  it("空状態（管理者）: 作成を促す文言 + 作成導線を出す", async () => {
    setupTemplates([]);
    renderScreen("admin");

    expect(
      await screen.findByText("テンプレートを作成すると、メッセージ生成で選択できるようになります"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "テンプレートを作成" })).toBeInTheDocument();
  });

  it("管理者の新規作成フォームが POST /templates を正しい body で呼ぶ", async () => {
    const fetchMock = setupClient((path, init) => {
      if (path.startsWith("/templates?")) return jsonResponse({ items: [], total: 0 });
      if (path.startsWith("/users?")) return jsonResponse({ items: [], total: 0 });
      if (path === "/templates" && init?.method === "POST") return jsonResponse(TEMPLATE, 201);
      throw new Error(`unexpected path: ${path}`);
    });
    renderScreen("admin");

    await userEvent.click(await screen.findByRole("button", { name: "テンプレートを作成" }));
    await userEvent.type(screen.getByLabelText("テンプレート名"), "初回接触テンプレ");
    await userEvent.type(
      screen.getByLabelText("自社紹介（骨子 — LLM では生成しない）"),
      "私たちは営業支援 SaaS を提供しています。",
    );
    await userEvent.type(
      screen.getByLabelText("CTA（骨子 — LLM では生成しない）"),
      "15 分のオンライン打ち合わせはいかがでしょうか。",
    );
    await userEvent.click(screen.getByRole("button", { name: "作成する" }));

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(postCall).toBeDefined();
    expect(String(postCall?.[0])).toBe(`${BASE}/templates`);
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      name: "初回接触テンプレ",
      introduction: "私たちは営業支援 SaaS を提供しています。",
      cta: "15 分のオンライン打ち合わせはいかがでしょうか。",
      tone: "",
      maxLength: 400,
    });
  });
});
