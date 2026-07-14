// S6 生成中モード（features/messages — pr-plan PR6b テスト観点）:
// 生成ポーリング（2 秒 — E13）が done で停止し、本文表示へ切り替わる（fake timers）
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import {
  AI_SEGMENT_LABEL,
  TEMPLATE_SEGMENT_LABEL,
} from "@/features/messages/components/message-body-editor";
import {
  GENERATING_MESSAGE_ID,
  MessageEditorScreen,
} from "@/features/messages/components/message-editor-screen";
import { ApiClient } from "@/lib/api/client";
import { POLLING_INTERVAL_MS } from "@/lib/config/polling";

const UUID_LIST = "99999999-0000-4000-8000-000000000000";
const UUID_ENTRY = "bbbbbbbb-2222-4222-8222-222222222222";
const UUID_JOB = "aaaaaaaa-7777-4777-8777-777777777777";
const UUID_MESSAGE = "aaaaaaaa-1111-4111-8111-111111111111";
const UUID_TEMPLATE = "cccccccc-3333-4333-8333-333333333333";
const UUID_DOSSIER = "dddddddd-4444-4444-8444-444444444444";

const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
}));

// ---- フェイク API ----
let jobFetchCount = 0;
/** 何回目の GET /message-jobs から done を返すか（それまでは queued） */
let doneAfterFetches = 2;

function makeJobJson(state: "queued" | "done") {
  return {
    id: UUID_JOB,
    listEntryId: UUID_ENTRY,
    state,
    messageId: state === "done" ? UUID_MESSAGE : null,
    error: null,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:10.000Z",
  };
}

function makeMessageJson() {
  const parts = {
    hook: "貴社の技術ブログを拝見しました",
    issueMention: "採用強化に伴う開発体制の課題があると推察します",
    introduction: "私たちは開発支援サービスを提供しています",
    cta: "15 分ほどお時間をいただけないでしょうか",
  };
  return {
    id: UUID_MESSAGE,
    listEntryId: UUID_ENTRY,
    templateId: UUID_TEMPLATE,
    dossierId: UUID_DOSSIER,
    parts,
    assembledBody: [parts.hook, parts.introduction, parts.issueMention, parts.cta].join("\n\n"),
    editedBody: null,
    validation: { ok: true, warnings: [] },
    modelId: "test-model",
    generatedAt: "2026-07-12T00:00:00.000Z",
    editedAt: null,
  };
}

const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const path = url.pathname.replace("/api/v1", "");

  if (method === "GET" && path === `/message-jobs/${UUID_JOB}`) {
    jobFetchCount += 1;
    return json(makeJobJson(jobFetchCount >= doneAfterFetches ? "done" : "queued"));
  }
  if (method === "GET" && path === `/messages/${UUID_MESSAGE}`) {
    return json(makeMessageJson());
  }
  if (method === "GET" && path === `/templates/${UUID_TEMPLATE}`) {
    return json({
      id: UUID_TEMPLATE,
      name: "テンプレ A",
      introduction: "私たちは開発支援サービスを提供しています",
      cta: "15 分ほどお時間をいただけないでしょうか",
      tone: "丁寧",
      maxLength: 500,
      createdBy: null,
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
  }
  if (method === "GET" && path === `/lists/${UUID_LIST}`) {
    return json({
      id: UUID_LIST,
      name: "テストリスト",
      searchCondition: { limit: 200 },
      createdBy: null,
      createdAt: "2026-07-01T00:00:00.000Z",
    });
  }
  if (method === "GET" && path === `/lists/${UUID_LIST}/entries`) {
    return json({
      items: [
        {
          id: UUID_ENTRY,
          companyListId: UUID_LIST,
          company: {
            id: "ffffffff-6666-4666-8666-666666666666",
            name: "テスト株式会社",
            domain: null,
            industry: null,
            employeeRange: null,
            region: null,
          },
          matchEvidence: [],
          status: "not_started",
          assigneeId: null,
          latestDeepDiveJobId: null,
          createdAt: "2026-07-10T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      ],
      total: 1,
    });
  }
  if (method === "GET" && path === `/entries/${UUID_ENTRY}/dossier`) {
    return json(
      {
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "ドシエが見つかりません",
          requestId: "req-1",
        },
      },
      404,
    );
  }
  throw new Error(`unexpected request: ${method} ${url.pathname}`);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

vi.mock("@/lib/api/browser", () => ({
  getBrowserApiClient: () =>
    new ApiClient({
      baseUrl: "http://api.test/api/v1",
      getAccessToken: async () => "token",
      fetchFn: fakeFetch,
    }),
}));

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderGeneratingScreen() {
  return render(
    <ToastProvider>
      <MessageEditorScreen
        listId={UUID_LIST}
        entryId={UUID_ENTRY}
        messageId={GENERATING_MESSAGE_ID}
        jobId={UUID_JOB}
        templateId={UUID_TEMPLATE}
      />
    </ToastProvider>,
  );
}

describe("MessageEditorScreen — 生成中モード（ui-spec 4.5）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    jobFetchCount = 0;
    doneAfterFetches = 2;
    routerReplace.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("生成中はスケルトン + 文言を表示し、done で本文表示に切り替わりポーリングが停止する", async () => {
    renderGeneratingScreen();
    // 初回のジョブ取得（queued）を反映
    await advance(0);
    expect(screen.getByText("メッセージを生成しています…")).toBeInTheDocument();
    expect(jobFetchCount).toBe(1);

    // 1 周期（2 秒）後のポーリングで done → メッセージ取得 → 本文表示
    await advance(POLLING_INTERVAL_MS.messageGeneration);
    expect(jobFetchCount).toBe(2);
    expect(screen.queryByText("メッセージを生成しています…")).not.toBeInTheDocument();
    expect(screen.getAllByText(TEMPLATE_SEGMENT_LABEL)).toHaveLength(2);
    expect(screen.getAllByText(AI_SEGMENT_LABEL)).toHaveLength(2);
    expect(screen.getByText("貴社の技術ブログを拝見しました")).toBeInTheDocument();

    // URL は実 messageId へ置換される
    expect(routerReplace).toHaveBeenCalledWith(
      `/lists/${UUID_LIST}/entries/${UUID_ENTRY}/messages/${UUID_MESSAGE}`,
    );

    // done 後はポーリングが止まる
    const countAfterDone = jobFetchCount;
    await advance(POLLING_INTERVAL_MS.messageGeneration * 5);
    expect(jobFetchCount).toBe(countAfterDone);
  });

  it("ポーリングは 2 秒間隔で継続する（done まで）", async () => {
    doneAfterFetches = 4;
    renderGeneratingScreen();
    await advance(0);
    expect(jobFetchCount).toBe(1);

    await advance(POLLING_INTERVAL_MS.messageGeneration);
    expect(jobFetchCount).toBe(2);
    expect(screen.getByText("メッセージを生成しています…")).toBeInTheDocument();

    await advance(POLLING_INTERVAL_MS.messageGeneration);
    expect(jobFetchCount).toBe(3);
    expect(screen.getByText("メッセージを生成しています…")).toBeInTheDocument();
  });
});
