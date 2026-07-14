// S5 メッセージペイン / S6 メッセージ編集のデータアクセス層。
// 型契約は @is-reach/shared の zod スキーマのみを使い、レスポンスは必ずスキーマ検証する。
import {
  companyListSchema,
  dossierSchema,
  generateMessageResponseSchema,
  listEntrySchema,
  messageJobSchema,
  messageSchema,
  paginatedResponseSchema,
  templateSchema,
  type CompanyList,
  type Dossier,
  type EntryStatus,
  type ListEntry,
  type Message,
  type MessageJob,
  type Paginated,
  type Template,
} from "@is-reach/shared";
import { ApiClientError, type ApiClient } from "@/lib/api/client";

/** エントリ走査のページサイズ（API の limit 上限 = 200 を使う） */
const ENTRY_SCAN_LIMIT = 200;
/** エントリ走査の上限ページ数（暴走防止の仮置き — features/dossier/api.ts と同値） */
const ENTRY_SCAN_MAX_PAGES = 25;

const listEntriesPageSchema = paginatedResponseSchema(listEntrySchema);
const messagesPageSchema = paginatedResponseSchema(messageSchema);
const templatesPageSchema = paginatedResponseSchema(templateSchema);

export async function fetchList(
  client: ApiClient,
  listId: string,
  signal?: AbortSignal,
): Promise<CompanyList> {
  return client.request(`/lists/${encodeURIComponent(listId)}`, companyListSchema, { signal });
}

/**
 * リスト内からエントリを 1 件探す。
 * 仮置き: GET /entries/:entryId が存在しないためページ走査で探す。
 * features/dossier/api.ts と同一実装（feature 間 import 禁止 — ui-spec U3 — のための重複。
 * 専用エンドポイント追加を PR 計画へ提案する）。
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

/** エントリのメッセージ一覧（生成日時降順 — S5 右ペイン。まず先頭 50 件のみ表示する仮置き） */
export async function fetchMessages(
  client: ApiClient,
  entryId: string,
  signal?: AbortSignal,
): Promise<Paginated<Message>> {
  return client.request(
    `/entries/${encodeURIComponent(entryId)}/messages?limit=50&offset=0`,
    messagesPageSchema,
    { signal },
  );
}

export async function fetchMessage(
  client: ApiClient,
  messageId: string,
  signal?: AbortSignal,
): Promise<Message> {
  return client.request(`/messages/${encodeURIComponent(messageId)}`, messageSchema, { signal });
}

/** テンプレート一覧（テンプレ選択モーダル + テンプレ名解決用。上限 200 件の仮置き） */
export async function fetchTemplates(
  client: ApiClient,
  signal?: AbortSignal,
): Promise<Paginated<Template>> {
  return client.request("/templates?limit=200&offset=0", templatesPageSchema, { signal });
}

/** テンプレート単体取得。削除済み（404）は null（メッセージ表示は継続する） */
export async function fetchTemplateOrNull(
  client: ApiClient,
  templateId: string,
  signal?: AbortSignal,
): Promise<Template | null> {
  try {
    return await client.request(`/templates/${encodeURIComponent(templateId)}`, templateSchema, {
      signal,
    });
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/** ドシエ取得（S6 参照ペイン用）。404 は null */
export async function fetchDossierOrNull(
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

/** メッセージ生成ジョブの投入（202 Accepted → jobId） */
export async function generateMessage(
  client: ApiClient,
  entryId: string,
  templateId: string,
): Promise<string> {
  const response = await client.request(
    `/entries/${encodeURIComponent(entryId)}/messages`,
    generateMessageResponseSchema,
    { method: "POST", body: { templateId } },
  );
  return response.jobId;
}

export async function fetchMessageJob(
  client: ApiClient,
  jobId: string,
  signal?: AbortSignal,
): Promise<MessageJob> {
  return client.request(`/message-jobs/${encodeURIComponent(jobId)}`, messageJobSchema, {
    signal,
  });
}

/** 編集後本文の保存（PATCH — 更新後のメッセージを返す） */
export async function updateMessageBody(
  client: ApiClient,
  messageId: string,
  editedBody: string,
): Promise<Message> {
  return client.request(`/messages/${encodeURIComponent(messageId)}`, messageSchema, {
    method: "PATCH",
    body: { editedBody },
  });
}

/** コピー操作の監査記録（POST /messages/:messageId/copy-events — 204） */
export async function recordCopyEvent(client: ApiClient, messageId: string): Promise<void> {
  await client.requestVoid(`/messages/${encodeURIComponent(messageId)}/copy-events`, {
    method: "POST",
  });
}

/** エントリのステータス更新（コピー後の「送信済みにする」提案用） */
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
