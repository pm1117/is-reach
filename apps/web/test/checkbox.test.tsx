// Checkbox（PR6b 共通基盤）: 汎用チェックボックス + indeterminate（テーブルヘッダの全選択用）
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "@/components/ui/checkbox";

describe("Checkbox", () => {
  it("label を関連付け、ラベルクリックでも切り替えられる", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox label="全選択" checked={false} onChange={onChange} />);

    const checkbox = screen.getByRole("checkbox", { name: "全選択" });
    await user.click(screen.getByText("全選択"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(checkbox).not.toBeChecked();
  });

  it("indeterminate を DOM プロパティへ反映し、解除もできる", () => {
    const { rerender } = render(<Checkbox aria-label="全選択" indeterminate readOnly />);
    const checkbox = screen.getByRole("checkbox", { name: "全選択" });
    expect(checkbox).toHaveProperty("indeterminate", true);

    rerender(<Checkbox aria-label="全選択" indeterminate={false} readOnly />);
    expect(checkbox).toHaveProperty("indeterminate", false);
  });

  it("label なし（テーブルヘッダ等）では aria-label でアクセス可能名を与えられる", () => {
    render(<Checkbox aria-label="すべての行を選択" readOnly />);
    expect(screen.getByRole("checkbox", { name: "すべての行を選択" })).toBeInTheDocument();
  });

  it("disabled が input へ伝わる", () => {
    render(<Checkbox label="選択" disabled readOnly />);
    expect(screen.getByRole("checkbox", { name: "選択" })).toBeDisabled();
  });
});
