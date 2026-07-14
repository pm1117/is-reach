"use client";

// S1 ブロック 1: 最近のリスト（直近 5 件 — 名前・作成日時・リンク）
import Link from "next/link";
import type { CompanyList, Paginated } from "@is-reach/shared";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SafeText } from "@/components/ui/safe-text";
import type { ApiQueryState } from "@/lib/api/use-api-query";
import { formatDateTimeJst } from "@/lib/format/date";
import { BlockSkeleton } from "./block-skeleton";

/** リスト 0 件時の初回導線（ui-spec 4.2 のリスト一覧文言に準拠） */
export function NoListsEmptyState() {
  return (
    <EmptyState
      title="まだリストがありません"
      description="スクリーニング検索から企業を抽出して保存しましょう"
      action={
        <Link
          href="/screening"
          className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-on hover:bg-primary-hover"
        >
          スクリーニング検索へ
        </Link>
      }
    />
  );
}

export interface RecentListsBlockProps {
  state: ApiQueryState<Paginated<CompanyList>>;
  onRetry: () => void;
}

export function RecentListsBlock({ state, onRetry }: RecentListsBlockProps) {
  return (
    <Card title="最近のリスト">
      {state.status === "loading" ? <BlockSkeleton rows={5} /> : null}
      {state.status === "error" ? (
        <ErrorState requestId={state.requestId} onRetry={onRetry} />
      ) : null}
      {state.status === "ready" ? (
        state.data.items.length === 0 ? (
          <NoListsEmptyState />
        ) : (
          <ul className="divide-y divide-neutral-100">
            {state.data.items.map((list) => (
              <li key={list.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  {/* リスト名はユーザー入力由来のため SafeText（ui-spec 7 章 — U8） */}
                  <SafeText
                    text={list.name}
                    maxLines={1}
                    className="text-sm font-medium text-neutral-800"
                  />
                  <p className="text-xs text-neutral-500">
                    作成: {formatDateTimeJst(list.createdAt)}
                  </p>
                </div>
                <Link
                  href={`/lists/${list.id}`}
                  className="shrink-0 text-sm font-medium text-primary hover:text-primary-hover"
                >
                  開く
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Card>
  );
}
