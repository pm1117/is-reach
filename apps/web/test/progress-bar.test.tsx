// ProgressBar（PR6b 共通基盤 — ui-spec 4.5）: パーセントを示さない不定プログレスバー
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "@/components/ui/progress-bar";

describe("ProgressBar", () => {
  it("progressbar ロールを持ち、aria-label で説明できる", () => {
    render(<ProgressBar label="公開情報を収集しています" />);
    expect(
      screen.getByRole("progressbar", { name: "公開情報を収集しています" }),
    ).toBeInTheDocument();
  });

  it("進捗率を持たない（aria-valuenow なし = 不定表示。パーセントで誤解を与えない）", () => {
    render(<ProgressBar label="実行中" />);
    const bar = screen.getByRole("progressbar", { name: "実行中" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar.textContent).not.toMatch(/%/);
  });
});
