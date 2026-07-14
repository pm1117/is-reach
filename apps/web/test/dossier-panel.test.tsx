// S5 ドシエ表示（features/dossier — pr-plan PR6b レビュー必須観点）:
// - 根拠なし項目に「根拠なし」バッジと注記が表示される（要件 F3 受け入れ条件 2）
// - ドシエ本文が HTML として解釈されない（SafeText — ui-spec 7 章 U8）
// - 実行中はフェーズ表示でありパーセントを表示しない（ui-spec 4.5 — U6）
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DeepDiveJob, Dossier } from "@is-reach/shared";
import { DeepDiveProgress } from "@/features/dossier/components/deep-dive-progress";
import { DossierPanel } from "@/features/dossier/components/dossier-panel";
import { NO_EVIDENCE_NOTE } from "@/features/dossier/components/dossier-section-item";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function makeDossier(overrides: Partial<Dossier> = {}): Dossier {
  return {
    id: UUID_A,
    listEntryId: UUID_B,
    businessSummary: {
      body: "SaaS 向けの受託開発を行う企業",
      evidence: { kind: "sources", urls: ["https://example.com/about"] },
    },
    inferredIssues: [
      {
        body: "<img src=x onerror=alert(1)>採用強化中とみられる",
        evidence: { kind: "none" },
      },
    ],
    serviceHooks: [],
    sources: [],
    warnings: [],
    modelId: "test-model",
    generatedAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

function renderPanel(dossier: Dossier | null, job: DeepDiveJob | null = null) {
  return render(
    <DossierPanel
      dossierState={{ status: "ready", data: dossier }}
      reloadDossier={() => undefined}
      job={job}
      deepDiveActionPending={false}
      onRunDeepDive={() => undefined}
      onRetryDeepDive={() => undefined}
    />,
  );
}

describe("DossierPanel", () => {
  it("根拠なし項目に「根拠なし」バッジと注記を表示する", () => {
    renderPanel(makeDossier());
    expect(screen.getByText("根拠なし")).toBeInTheDocument();
    expect(screen.getByText(NO_EVIDENCE_NOTE)).toBeInTheDocument();
  });

  it("根拠あり項目には出典 URL の外部リンクを表示する", () => {
    renderPanel(makeDossier());
    const link = screen.getByRole("link", { name: /example\.com/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("ドシエ本文を HTML として解釈しない（プレーンテキスト表示）", () => {
    const { container } = renderPanel(makeDossier());
    // タグ文字列がそのままテキストとして見えること（img 要素は生成されない）
    expect(container.querySelector("img")).toBeNull();
    expect(
      screen.getByText(/<img src=x onerror=alert\(1\)>採用強化中とみられる/),
    ).toBeInTheDocument();
  });

  it("未生成（null）なら空状態と「深掘りを実行」ボタンを表示する", () => {
    renderPanel(null);
    expect(screen.getByText("まだ深掘りが実行されていません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "深掘りを実行" })).toBeInTheDocument();
  });

  it("ドシエの警告があれば warning バナーを表示する", () => {
    renderPanel(
      makeDossier({
        warnings: [{ code: "EVIDENCE_URL_UNKNOWN", detail: "unknown url" }],
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("出典不明の根拠 URL");
  });
});

describe("DeepDiveProgress", () => {
  it("フェーズ表示のみでパーセントを表示しない（ui-spec 4.5）", () => {
    const { container } = render(<DeepDiveProgress state="collecting" />);
    expect(screen.getByText("公開情報を収集しています")).toBeInTheDocument();
    expect(screen.getByText("収集")).toBeInTheDocument();
    expect(screen.getByText("分析")).toBeInTheDocument();
    expect(screen.getByText("完了")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/%/);
    // 不定プログレスバー（aria-valuenow を持たない）
    const bar = screen.getByRole("progressbar");
    expect(bar).not.toHaveAttribute("aria-valuenow");
  });
});
