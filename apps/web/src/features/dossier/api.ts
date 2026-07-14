// S5 企業詳細（ドシエ側）のデータアクセス層。
// 型契約は @is-reach/shared の zod スキーマのみを使い、レスポンスは必ずスキーマ検証する。
import {
  companyListSchema,
  createDeepDiveJobsResponseSchema,
  deepDiveJobSchema,
  dossierSchema,
  listEntrySchema,
  paginatedResponseSchema,
  type CompanyList,
  type CreateDeepDiveJobsResponse,
  type DeepDiveJob,
  type Dossier,
  type EntryStatus,
  type ListEntry,
} from "@is-reach/shared";
import { ApiClientError, type ApiClient } from "@/lib/api/client";

/** エントリ走査のページサイズ（API の limit 上限 = 200 を使う） */
const ENTRY_SCAN_LIMIT = 200;
/**
 * エントリ走査の上限ページ数（暴走防止の仮置き。200 件 × 25 = 5,000 エントリまで走査）。
 * GET /entries/:entryId が未提供のための暫定実装（PR 本文に申し送り）。
 */
const ENTRY_SCAN_MAX_PAGES = 25;

const listEntriesPageSchema = paginatedResponseSchema(listEntrySchema);

export async function fetchList(
  client: ApiClient,
  listId: string,
  signal?: AbortSignal,
): Promise<CompanyList> {
  return client.request(`/lists/${encodeURIComponent(listId)}`, companyListSchema, { signal });
}

/**
 * リスト内からエントリを 1 件探す。
 * 仮置き: GET /entries/:entryId が存在しないため、GET /lists/:listId/entries を
 * limit=200 でページ走査して該当 id を探す（専用エンドポイント追加は PR 計画への提案事項）。
 */
export async function findListEntry(
  client: ApiClient,
  listId: string,
  entryId: string,
  signal?: AbortSignal,
): Promise<ListEntry> {
  for (let page = 0; page < ENTRY_SCAN_MAX_PAGES; page += 1) {
    const offset = page * ENTRY_SCAN_LIMIT;
    const result = await client.request(
      `/lists/${encodeURIComponent(listId)}/entries?limit=${ENTRY_SCAN_LIMIT}&offset=${offset}`,
      listEntriesPageSchema,
      { signal },
    );
    const found = result.items.find((item) => item.id === entryId);
    if (found !== undefined) {
      return found;
    }
    if (offset + ENTRY_SCAN_LIMIT >= result.total) {
      break;
    }
  }
  throw new ApiClientError({
    code: "RESOURCE_NOT_FOUND",
    message: "エントリが見つかりません",
    status: 404,
    requestId: null,
  });
}

/** ドシエ取得。404（未生成）は null を返す（ui-spec 4.2 の空状態表示に使う） */
export async function fetchDossier(
  client: ApiClient,
  entryId: string,
  signal?: AbortSignal,
): Promise<Dossier | null> {
  try {
    return await client.request(`/entries/${encodeURIComponent(entryId)}/dossier`, dossierSchema, {
      signal,
    });
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function fetchDeepDiveJob(
  client: ApiClient,
  jobId: string,
  signal?: AbortSignal,
): Promise<DeepDiveJob> {
  return client.request(`/deep-dive-jobs/${encodeURIComponent(jobId)}`, deepDiveJobSchema, {
    signal,
  });
}

/** 深掘りジョブの投入（S5 からは単一エントリのみ） */
export async function createDeepDiveJob(
  client: ApiClient,
  entryId: string,
): Promise<CreateDeepDiveJobsResponse> {
  return client.request("/deep-dive-jobs", createDeepDiveJobsResponseSchema, {
    method: "POST",
    body: { entryIds: [entryId] },
  });
}

/** failed → queued の再実行（design-detail 4.1） */
export async function retryDeepDiveJob(client: ApiClient, jobId: string): Promise<DeepDiveJob> {
  return client.request(`/deep-dive-jobs/${encodeURIComponent(jobId)}/retry`, deepDiveJobSchema, {
    method: "POST",
  });
}

/** エントリのステータス更新（要件 F5。更新後のエントリを返す） */
export async function updateEntryStatus(
  client: ApiClient,
  entryId: string,
  status: EntryStatus,
): Promise<ListEntry> {
  return client.request(`/entries/${encodeURIComponent(entryId)}`, listEntrySchema, {
    method: "PATCH",
    body: { status },
  });
}
