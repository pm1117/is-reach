"use client";

// S1 ダッシュボード（3 ブロック簡易版 — ui-spec 2.2 決定 U2）。
// 各ブロックは領域単位でローディング / エラーを持ち、1 ブロックの失敗が他を壊さない（ui-spec 4.3）。
// ブロック 2・3 は同じ合成取得（fetchDashboardActivity）を共有する簡易化を採る
// （同一データの二重取得を避けるため。取得失敗時は両ブロックがそれぞれ ErrorState を出す）。
import { useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { getBrowserApiClient } from "@/lib/api/browser";
import { useApiQuery } from "@/lib/api/use-api-query";
import { fetchDashboardActivity, fetchRecentLists } from "../api";
import { DeepDiveJobsBlock } from "./deep-dive-jobs-block";
import { RecentListsBlock } from "./recent-lists-block";
import { StatusSummaryBlock } from "./status-summary-block";

export function DashboardScreen() {
  const client = getBrowserApiClient();
  const recentLists = useApiQuery(
    useCallback((signal: AbortSignal) => fetchRecentLists(client, signal), [client]),
  );
  const activity = useApiQuery(
    useCallback((signal: AbortSignal) => fetchDashboardActivity(client, signal), [client]),
  );

  return (
    <div>
      <PageHeader title="ダッシュボード" />
      <div className="grid gap-4 xl:grid-cols-2">
        <RecentListsBlock state={recentLists.state} onRetry={recentLists.reload} />
        <DeepDiveJobsBlock state={activity.state} onRetry={activity.reload} />
        <div className="xl:col-span-2">
          <StatusSummaryBlock state={activity.state} onRetry={activity.reload} />
        </div>
      </div>
    </div>
  );
}
