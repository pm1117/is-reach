// サイドナビのロール別出し分け（ui-spec 1.4 / 8 章 — U9）
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SideNav } from "@/components/layout/side-nav";
import { makeMe } from "./helpers";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const ALL_ITEMS = ["ダッシュボード", "スクリーニング検索", "リスト", "テンプレート"] as const;
const ADMIN_ONLY_ITEMS = ["設定", "監査ログ"] as const;

describe("SideNav", () => {
  it("管理者には全ナビ項目を業務フロー順に表示する", () => {
    render(<SideNav me={makeMe("admin")} />);
    for (const label of [...ALL_ITEMS, ...ADMIN_ONLY_ITEMS]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    const labels = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(labels).toEqual([...ALL_ITEMS, ...ADMIN_ONLY_ITEMS]);
  });

  it("メンバーには管理者専用項目（設定・監査ログ）を表示しない", () => {
    render(<SideNav me={makeMe("member")} />);
    for (const label of ALL_ITEMS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const label of ADMIN_ONLY_ITEMS) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("me 未取得（null）の間は管理者専用項目を表示しない（fail-closed）", () => {
    render(<SideNav me={null} />);
    for (const label of ADMIN_ONLY_ITEMS) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("現在地のナビ項目に aria-current='page' を付ける", () => {
    render(<SideNav me={makeMe("member")} />);
    expect(screen.getByText("ダッシュボード")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("リスト")).not.toHaveAttribute("aria-current");
  });

  it("アカウントメニューに表示名とロールバッジを表示する", () => {
    render(<SideNav me={makeMe("member")} />);
    expect(screen.getByText("テスト担当者")).toBeInTheDocument();
    expect(screen.getByText("メンバー")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
  });

  it("管理者のロールバッジは「管理者」", () => {
    render(<SideNav me={makeMe("admin")} />);
    expect(screen.getByText("管理者")).toBeInTheDocument();
  });
});
