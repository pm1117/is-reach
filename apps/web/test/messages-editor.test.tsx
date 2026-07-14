// S6 メッセージ編集（features/messages — pr-plan PR6b レビュー必須観点）:
// - 警告付きメッセージのコピーで確認ダイアログが出る / 警告なしでは出ない（ui-spec 6.3）
// - コピー後にステータスが自動更新されない（PATCH /entries が呼ばれない）+ 提案 UI が出る（6.4）
// - 「送信」単独のボタンが存在しない（「送信済みにする」は可 — 6.5）
// - 骨子とパーソナライズの視覚区別（ラベル）が初期表示に出る（6.2）
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, Template } from "@is-reach/shared";
import { ToastProvider } from "@/components/ui/toast";
import {
  AI_SEGMENT_LABEL,
  TEMPLATE_SEGMENT_LABEL,
} from "@/features/messages/components/message-body-editor";
import { MessageEditor } from "@/features/messages/components/message-editor";
import { ApiClient } from "@/lib/api/client";

const UUID_MESSAGE = "aaaaaaaa-1111-4111-8111-111111111111";
const UUID_ENTRY = "bbbbbbbb-2222-4222-8222-222222222222";
const UUID_TEMPLATE = "cccccccc-3333-4333-8333-333333333333";
const UUID_DOSSIER = "dddddddd-4444-4444-8444-444444444444";

// ---- fetch 呼び出しを記録するフェイク API ----
interface RecordedCall {
  method: string;
  path: string;
}
const calls: RecordedCall[] = [];

const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const path = url.pathname.replace("/api/v1", "");
  calls.push({ method, path });

  if (method === "POST" && path === `/messages/${UUID_MESSAGE}/copy-events`) {
    return new Response(null, { status: 204 });
  }
  if (method === "PATCH" && path === `/entries/${UUID_ENTRY}`) {
    return new Response(JSON.stringify(makeEntryJson()), { status: 200 });
  }
  if (method === "PATCH" && path === `/messages/${UUID_MESSAGE}`) {
    return new Response(JSON.stringify(makeMessage({ editedBody: "編集後の本文" })), {
      status: 200,
    });
  }
  if (method === "GET" && path === `/entries/${UUID_ENTRY}/dossier`) {
    // 参照ペインはドシエなしで検証する
    return new Response(
      JSON.stringify({
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "ドシエが見つかりません",
          requestId: "req-1",
        },
      }),
      { status: 404 },
    );
  }
  throw new Error(`unexpected request: ${method} ${url.pathname}`);
};

vi.mock("@/lib/api/browser", () => ({
  getBrowserApiClient: () =>
    new ApiClient({
      baseUrl: "http://api.test/api/v1",
      getAccessToken: async () => "token",
      fetchFn: fakeFetch,
    }),
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  const parts = {
    hook: "貴社の技術ブログを拝見しました",
    issueMention: "採用強化に伴う開発体制の課題があると推察します",
    introduction: "私たちは開発支援サービスを提供しています",
    cta: "15 分ほどお時間をいただけないでしょうか",
  };
  const assembledBody = [parts.hook, parts.introduction, parts.issueMention, parts.cta].join(
    "\n\n",
  );
  return {
    id: UUID_MESSAGE,
    listEntryId: UUID_ENTRY,
    templateId: UUID_TEMPLATE,
    dossierId: UUID_DOSSIER,
    parts,
    assembledBody,
    editedBody: null,
    validation: { ok: true, warnings: [] },
    modelId: "test-model",
    generatedAt: "2026-07-12T00:00:00.000Z",
    editedAt: null,
    ...overrides,
  };
}

function makeEntryJson() {
  return {
    id: UUID_ENTRY,
    companyListId: "eeeeeeee-5555-4555-8555-555555555555",
    company: {
      id: "ffffffff-6666-4666-8666-666666666666",
      name: "テスト株式会社",
      domain: null,
      industry: null,
      employeeRange: null,
      region: null,
    },
    matchEvidence: [],
    status: "sent",
    assigneeId: null,
    latestDeepDiveJobId: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
}

function makeTemplate(): Template {
  return {
    id: UUID_TEMPLATE,
    name: "テンプレ A",
    introduction: "私たちは開発支援サービスを提供しています",
    cta: "15 分ほどお時間をいただけないでしょうか",
    tone: "丁寧",
    maxLength: 500,
    createdBy: null,
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

function stubClipboard() {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

/** userEvent.setup() は navigator.clipboard を自前スタブで置換するため、setup 後にスパイを上書きする */
function setupUser() {
  const user = userEvent.setup();
  stubClipboard();
  return user;
}

function renderEditor(message: Message) {
  return render(
    <ToastProvider>
      <MessageEditor
        entryId={UUID_ENTRY}
        message={message}
        template={makeTemplate()}
        onRegenerate={async () => undefined}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  calls.length = 0;
  writeText.mockClear();
  stubClipboard();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MessageEditor — セグメント表示（ui-spec 6.2）", () => {
  it("初期表示で骨子とパーソナライズの視覚区別ラベルが出る", () => {
    renderEditor(makeMessage());
    expect(screen.getAllByText(TEMPLATE_SEGMENT_LABEL)).toHaveLength(2);
    expect(screen.getAllByText(AI_SEGMENT_LABEL)).toHaveLength(2);
    // 組み立て順どおり各パートの本文が見える
    expect(screen.getByText("貴社の技術ブログを拝見しました")).toBeInTheDocument();
    expect(screen.getByText("15 分ほどお時間をいただけないでしょうか")).toBeInTheDocument();
  });

  it("検証警告があると warning バナーに要約を表示する", () => {
    renderEditor(
      makeMessage({
        validation: {
          ok: false,
          warnings: [{ code: "LENGTH_EXCEEDED", detail: "too long" }],
        },
      }),
    );
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("この生成文は自動検証で警告が検出されました");
    expect(banner).toHaveTextContent("文字数制約の超過");
  });
});

describe("MessageEditor — コピー動線（ui-spec 6.3 / 6.4）", () => {
  it("警告付きメッセージのコピーで確認ダイアログが出て、確認後にコピーされる", async () => {
    const user = setupUser();
    renderEditor(
      makeMessage({
        validation: {
          ok: false,
          warnings: [{ code: "SKELETON_MISSING", detail: "missing" }],
        },
      }),
    );

    await user.click(screen.getByRole("button", { name: "本文をコピー" }));
    // ダイアログが出て、この時点ではコピーされない
    const dialog = screen.getByRole("dialog", { name: "検証警告があります" });
    expect(dialog).toHaveTextContent(
      "このメッセージには検証警告があります。内容を確認しましたか？",
    );
    expect(writeText).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "確認済み・コピーする" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(
      calls.filter((c) => c.method === "POST" && c.path.endsWith("/copy-events")),
    ).toHaveLength(1);
  });

  it("警告なしのコピーでは確認ダイアログを出さずコピーする", async () => {
    const user = setupUser();
    renderEditor(makeMessage());

    await user.click(screen.getByRole("button", { name: "本文をコピー" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // 保存済み本文（editedBody ?? assembledBody）がコピーされる
    expect(writeText).toHaveBeenCalledWith(makeMessage().assembledBody);
  });

  it("コピー後にステータスは自動更新されず、提案 UI からのみ更新できる", async () => {
    const user = setupUser();
    renderEditor(makeMessage());

    await user.click(screen.getByRole("button", { name: "本文をコピー" }));
    await waitFor(() =>
      expect(screen.getByText("ステータスを送信済みにしますか？")).toBeInTheDocument(),
    );
    // 自動では PATCH /entries を呼ばない（ui-spec 6.4 — 決定）
    expect(
      calls.filter((c) => c.method === "PATCH" && c.path.startsWith("/entries/")),
    ).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "送信済みにする" }));
    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === "PATCH" && c.path === `/entries/${UUID_ENTRY}`),
      ).toHaveLength(1),
    );
  });

  it("「送信」単独のボタンは存在しない（ui-spec 6.5）", async () => {
    const user = setupUser();
    renderEditor(makeMessage());
    await user.click(screen.getByRole("button", { name: "本文をコピー" }));
    await waitFor(() =>
      expect(screen.getByText("ステータスを送信済みにしますか？")).toBeInTheDocument(),
    );

    for (const button of screen.getAllByRole("button")) {
      const name = button.textContent?.trim() ?? "";
      expect(name).not.toMatch(/^送信$/);
      expect(name).not.toMatch(/^送信する$/);
    }
    // 「送信済みにする」は許可される
    expect(screen.getByRole("button", { name: "送信済みにする" })).toBeInTheDocument();
  });

  it("未保存の変更があるとコピー前に「保存してコピー」確認を出し、保存後にコピーする", async () => {
    const user = setupUser();
    renderEditor(makeMessage());

    // 編集モードへ切替えて本文を変更
    await user.click(screen.getByRole("button", { name: "本文を編集" }));
    const textarea = screen.getByRole("textbox", { name: "メッセージ本文" });
    await user.clear(textarea);
    await user.type(textarea, "編集後の本文");

    await user.click(screen.getByRole("button", { name: "本文をコピー" }));
    expect(screen.getByRole("dialog", { name: "未保存の変更があります" })).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "保存してコピー" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    // 保存（PATCH /messages/:id）→ コピーの順で実行される
    expect(
      calls.filter((c) => c.method === "PATCH" && c.path === `/messages/${UUID_MESSAGE}`),
    ).toHaveLength(1);
    expect(writeText).toHaveBeenCalledWith("編集後の本文");
  });
});

describe("MessageEditor — 保存", () => {
  it("未変更のとき「変更を保存」は無効", () => {
    renderEditor(makeMessage());
    expect(screen.getByRole("button", { name: "変更を保存" })).toBeDisabled();
  });
});
