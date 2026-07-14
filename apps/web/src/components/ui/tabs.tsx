"use client";

import { cx } from "@/lib/cx";

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  items: ReadonlyArray<TabItem>;
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

/** 制御コンポーネントのタブ。タブパネル側は呼び出し元が activeId で出し分ける */
export function Tabs({ items, activeId, onChange, className }: TabsProps) {
  return (
    <div role="tablist" className={cx("flex gap-1 border-b border-neutral-200", className)}>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              active
                ? "border-primary text-primary"
                : "border-transparent text-neutral-500 hover:text-neutral-700",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
