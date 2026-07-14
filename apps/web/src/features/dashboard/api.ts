// S1 ダッシュボードのデータ取得（3 ブロック簡易版 — ui-spec 2.2 決定 U2）。
// apps/api に集計エンドポイントがないため（API 変更は PR6b スコープ外）、
// 既存の一覧系 API をクライアント側で合成して簡易表示する。
// 【仮置き】対象範囲・取得上限は以下の定数のとおり。集計 API 導入時にサーバー側へ移す。
import {
  companyListSchema,
  deepDiveJobSchema,
  listEntrySchema,
  paginatedResponseSchema,
  type CompanyList,
  type DeepDiveJob,
  type DeepDiveJobState,
  type ListEntry,
  type Paginated,
} from "@is-reach/shared";
import type { ApiClient } from "@/lib/api/client";

/** 「最近のリスト」ブロックの表示件数（仮置き） */
export const RECENT_LISTS_LIMIT = 5;
/** ジョブ・集計ブロックが走査する直近リスト数（仮置き — 全リスト走査は N+1 が過大なため） */
export const ACTIVITY_LISTS_LIMIT = 3;
/** 1 リストあたりのエントリ取得上限（API の limit 最大値） */
export const ACTIVITY_ENTRIES_LIMIT = 200;
/** ジョブ状態を個別取得する上限（仮置き — GET /deep-dive-jobs/:jobId の N+1 を抑える） */
export const ACTIVITY_JOB_LOOKUP_LIMIT = 20;

const listsResponseSchema = paginatedResponseSchema(companyListSchema);
const entriesResponseSchema = paginatedResponseSchema(listEntrySchema);

/** 実行中とみなす深掘りジョブ状態（ui-spec 4.5） */
const RUNNING_JOB_STATES: ReadonlySet<DeepDiveJobState> = new Set([
  "queued",
  "collecting",
  "analyzing",
]);

export function fetchRecentLists(
  client: ApiClient,
  signal: AbortSignal,
): Promise<Paginated<CompanyList>> {
  return client.request(`/lists?limit=${RECENT_LISTS_LIMIT}&offset=0`, listsResponseSchema, {
    signal,
  });
}

/** 直近リスト由来のエントリ（所属リストの表示情報を同伴させる） */
export interface ActivityEntry {
  entry: ListEntry;
  listId: string;
  listName: string;
}

/** 実行中の深掘りジョブ + 対象エントリ */
export interface RunningDeepDive extends ActivityEntry {
  job: DeepDiveJob;
}

export interface DashboardActivity {
  /** テナント内のリスト総数（0 件判定に使う） */
  totalListCount: number;
  /** 実際に走査した直近リスト数（集計対象範囲の注記に使う） */
  scannedListCount: number;
  entries: ReadonlyArray<ActivityEntry>;
  runningJobs: ReadonlyArray<RunningDeepDive>;
  /** ジョブ確認上限（ACTIVITY_JOB_LOOKUP_LIMIT）超過で状態未確認となった件数 */
  skippedJobLookups: number;
}

/**
 * 「進行中の深掘りジョブ」「ステータス集計」ブロック共用の合成取得。
 * 直近 ACTIVITY_LISTS_LIMIT 件のリスト → 各リストのエントリ → latestDeepDiveJobId を持つ
 * エントリのジョブ状態、の順に辿る。
 */
export async function fetchDashboardActivity(
  client: ApiClient,
  signal: AbortSignal,
): Promise<DashboardActivity> {
  const lists = await client.request(
    `/lists?limit=${ACTIVITY_LISTS_LIMIT}&offset=0`,
    listsResponseSchema,
    { signal },
  );

  const perList = await Promise.all(
    lists.items.map(async (list) => {
      const entries = await client.request(
        `/lists/${list.id}/entries?limit=${ACTIVITY_ENTRIES_LIMIT}&offset=0`,
        entriesResponseSchema,
        { signal },
      );
      return entries.items.map((entry): ActivityEntry => ({
        entry,
        listId: list.id,
        listName: list.name,
      }));
    }),
  );
  const entries = perList.flat();

  const withJobId = entries.flatMap((item) =>
    item.entry.latestDeepDiveJobId === null
      ? []
      : [{ ...item, jobId: item.entry.latestDeepDiveJobId }],
  );
  const lookups = withJobId.slice(0, ACTIVITY_JOB_LOOKUP_LIMIT);
  const jobs = await Promise.all(
    lookups.map(async (item): Promise<RunningDeepDive> => {
      const job = await client.request(`/deep-dive-jobs/${item.jobId}`, deepDiveJobSchema, {
        signal,
      });
      return { entry: item.entry, listId: item.listId, listName: item.listName, job };
    }),
  );

  return {
    totalListCount: lists.total,
    scannedListCount: lists.items.length,
    entries,
    runningJobs: jobs.filter((item) => RUNNING_JOB_STATES.has(item.job.state)),
    skippedJobLookups: withJobId.length - lookups.length,
  };
}
