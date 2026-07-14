"use client";

// 左サイドナビ（ui-spec 1.4 — 決定 U1）。業務フロー順に並べ、
// 管理者専用項目はメンバーには非表示にする（ui-spec 8 章 — U9。disabled 方式は採らない）。
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MeResponse } from "@is-reach/shared";
import { cx } from "@/lib/cx";
import { AccountMenu } from "./account-menu";

interface NavItem {
  href: string;
  label: string;
  adminOnly: boolean;
}

/** ui-spec 1.4 の並び順（決定） */
const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: "/dashboard", label: "ダッシュボード", adminOnly: false },
  { href: "/screening", label: "スクリーニング検索", adminOnly: false },
  { href: "/lists", label: "リスト", adminOnly: false },
  { href: "/templates", label: "テンプレート", adminOnly: false },
  { href: "/settings", label: "設定", adminOnly: true },
  { href: "/audit-logs", label: "監査ログ", adminOnly: true },
];

export interface SideNavProps {
  /** /me 取得前は null（アカウントメニューはスケルトン表示・管理者項目は非表示） */
  me: MeResponse | null;
}

export function SideNav({ me }: SideNavProps) {
  const pathname = usePathname();
  const isAdmin = me?.user.role === "admin";
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <nav
      aria-label="メインナビゲーション"
      className="flex min-h-screen w-60 shrink-0 flex-col border-r border-neutral-200 bg-neutral-0"
    >
      <div className="px-4 py-4 text-lg font-semibold text-neutral-900">is-reach</div>
      <ul className="flex-1 space-y-0.5 px-2">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "block rounded-md px-3 py-1.5 text-sm font-medium",
                  active
                    ? "bg-primary-subtle text-primary"
                    : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <AccountMenu me={me} />
    </nav>
  );
}
