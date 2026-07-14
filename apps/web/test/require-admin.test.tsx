// RequireAdmin / ForbiddenState（ui-spec 4.4 / 8 章 — U9）:
// URL 直打ちで管理者専用ルートに到達したメンバーには ForbiddenState を表示する
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RequireAdmin } from "@/components/layout/require-admin";
import { makeMe, withMeState } from "./helpers";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    // テスト用スタブ（next/link の代替。素の <a> 禁止 lint の対象外にするため文字列生成しない）
    <span data-href={href} {...rest}>
      {children}
    </span>
  ),
}));

describe("RequireAdmin", () => {
  it("メンバーには ForbiddenState を表示し、子コンテンツを出さない", () => {
    render(
      withMeState({
        state: { status: "ready", me: makeMe("member") },
        children: (
          <RequireAdmin>
            <p>管理者専用コンテンツ</p>
          </RequireAdmin>
        ),
      }),
    );
    expect(screen.getByText("この画面は管理者のみ利用できます")).toBeInTheDocument();
    expect(screen.getByText("ダッシュボードへ戻る")).toBeInTheDocument();
    expect(screen.queryByText("管理者専用コンテンツ")).toBeNull();
  });

  it("管理者には子コンテンツを表示する", () => {
    render(
      withMeState({
        state: { status: "ready", me: makeMe("admin") },
        children: (
          <RequireAdmin>
            <p>管理者専用コンテンツ</p>
          </RequireAdmin>
        ),
      }),
    );
    expect(screen.getByText("管理者専用コンテンツ")).toBeInTheDocument();
    expect(screen.queryByText("この画面は管理者のみ利用できます")).toBeNull();
  });

  it("読み込み中はローディング表示（コンテンツも Forbidden も出さない）", () => {
    render(
      withMeState({
        state: { status: "loading" },
        children: (
          <RequireAdmin>
            <p>管理者専用コンテンツ</p>
          </RequireAdmin>
        ),
      }),
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("管理者専用コンテンツ")).toBeNull();
  });

  it("エラー状態では fail-closed（ForbiddenState）", () => {
    render(
      withMeState({
        state: { status: "error", requestId: null },
        children: (
          <RequireAdmin>
            <p>管理者専用コンテンツ</p>
          </RequireAdmin>
        ),
      }),
    );
    expect(screen.getByText("この画面は管理者のみ利用できます")).toBeInTheDocument();
    expect(screen.queryByText("管理者専用コンテンツ")).toBeNull();
  });
});
