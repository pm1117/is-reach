"use client";

// S8 テナント設定・ユーザー管理（管理者のみ — U9。ルート側の RequireAdmin が入口を守る）。
// タブでセクションを整理する（ユーザー管理 / テナント設定 / データ削除依頼）。
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { DeletionSection } from "./deletion-section";
import { TenantSection } from "./tenant-section";
import { UsersSection } from "./users-section";

const TAB_ITEMS: ReadonlyArray<TabItem> = [
  { id: "users", label: "ユーザー管理" },
  { id: "tenant", label: "テナント設定" },
  { id: "deletion", label: "データ削除依頼" },
];

export function SettingsScreen() {
  const [tab, setTab] = useState("users");
  return (
    <div>
      <PageHeader title="テナント設定・ユーザー管理" />
      <Tabs items={TAB_ITEMS} activeId={tab} onChange={setTab} className="mb-4" />
      {tab === "users" ? <UsersSection /> : null}
      {tab === "tenant" ? <TenantSection /> : null}
      {tab === "deletion" ? <DeletionSection /> : null}
    </div>
  );
}
