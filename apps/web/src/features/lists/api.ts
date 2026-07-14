// S3 リスト一覧 / S4 リスト詳細の API ラッパ（design-detail 2.2 — 要件 F1 / F2 / F5）。
// 契約は @is-reach/shared の zod スキーマで検証する（lib/api/me.ts と同じ流儀）。
import {
  companyListSchema,
  createDeepDiveJobsResponseSchema,
  deepDiveJobSchema,
  listEntrySchema,
  paginatedResponseSchema,
  type CompanyList,
  type CreateDeepDiveJobsResponse,
  type DeepDiveJob,
  type EntryStatus,
  type ListEntry,
  type Paginated,
  type UpdateListEntryRequest,
} from "@is-reach/shared";
import type { ApiClient } from "@/lib/api/client";

const listsResponseSchema = paginatedResponseSchema(companyListSchema);
const entriesResponseSchema = paginatedResponseSchema(listEntrySchema);

export interface PageParams {
  limit: number;
  offset: number;
}

/** GET /lists — リスト一覧（limit/offset ページネーション） */
export function fetchCompanyLists(
  client: ApiClient,
  page: PageParams,
  signal?: AbortSignal,
): Promise<Paginated<CompanyList>> {
  const params = new URLSearchParams({
    limit: String(page.limit),
    offset: String(page.offset),
  });
  return client.request(`/lists?${params.toString()}`, listsResponseSchema, { signal });
}

/** GET /lists/:listId — リスト単体（S4 のパンくず・条件スナップショット表示用） */
export function fetchCompanyList(
  client: ApiClient,
  listId: string,
  signal?: AbortSignal,
): Promise<CompanyList> {
  return client.request(`/lists/${encodeURIComponent(listId)}`, companyListSchema, { signal });
}

/** PATCH /lists/:listId — リスト名変更 */
export function updateCompanyList(
  client: ApiClient,
  listId: string,
  name: string,
): Promise<CompanyList> {
  return client.request(`/lists/${encodeURIComponent(listId)}`, companyListSchema, {
    method: "PATCH",
    body: { name },
  });
}

/** DELETE /lists/:listId — リスト削除（権限は全員 — design-detail 2.2 優先で確定） */
export function deleteCompanyList(client: ApiClient, listId: string): Promise<void> {
  return client.requestVoid(`/lists/${encodeURIComponent(listId)}`, { method: "DELETE" });
}

export interface ListEntriesParams extends PageParams {
  /** ステータス絞り込み（listEntriesQuerySchema.status — 要件 F5） */
  status?: EntryStatus;
}

/** GET /lists/:listId/entries — エントリ一覧（絞り込み + ページネーション） */
export function fetchListEntries(
  client: ApiClient,
  listId: string,
  params: ListEntriesParams,
  signal?: AbortSignal,
): Promise<Paginated<ListEntry>> {
  const query = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
  });
  if (params.status !== undefined) {
    query.set("status", params.status);
  }
  return client.request(
    `/lists/${encodeURIComponent(listId)}/entries?${query.toString()}`,
    entriesResponseSchema,
    { signal },
  );
}

/** PATCH /entries/:entryId — ステータス・担当者のインライン更新（要件 F5） */
export function updateListEntry(
  client: ApiClient,
  entryId: string,
  request: UpdateListEntryRequest,
): Promise<ListEntry> {
  return client.request(`/entries/${encodeURIComponent(entryId)}`, listEntrySchema, {
    method: "PATCH",
    body: request,
  });
}

/** GET /deep-dive-jobs/:jobId — 深掘りジョブの状態取得（ポーリング対象 — ui-spec 4.5） */
export function fetchDeepDiveJob(
  client: ApiClient,
  jobId: string,
  signal?: AbortSignal,
): Promise<DeepDiveJob> {
  return client.request(`/deep-dive-jobs/${encodeURIComponent(jobId)}`, deepDiveJobSchema, {
    signal,
  });
}

/** POST /deep-dive-jobs — 選択エントリの一括深掘り実行（202 Accepted — 要件 F2） */
export function createDeepDiveJobs(
  client: ApiClient,
  entryIds: readonly string[],
): Promise<CreateDeepDiveJobsResponse> {
  return client.request("/deep-dive-jobs", createDeepDiveJobsResponseSchema, {
    method: "POST",
    body: { entryIds },
  });
}

/** POST /deep-dive-jobs/:jobId/retry — failed → queued の再実行（basic-design 4.3） */
export function retryDeepDiveJob(client: ApiClient, jobId: string): Promise<DeepDiveJob> {
  return client.request(`/deep-dive-jobs/${encodeURIComponent(jobId)}/retry`, deepDiveJobSchema, {
    method: "POST",
  });
}
