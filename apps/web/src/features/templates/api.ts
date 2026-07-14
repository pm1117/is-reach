// S7 テンプレート管理の API 呼び出し（design-detail 2.2 — 要件 F4 / 決定 E3）。
// 閲覧は全員・変更系は管理者のみ（サーバー側認可が本線。UI は非表示で追随 — U9）。
import {
  paginatedResponseSchema,
  templateSchema,
  tenantUserSchema,
  type CreateTemplateRequest,
  type Paginated,
  type Template,
  type TenantUser,
  type UpdateTemplateRequest,
} from "@is-reach/shared";
import { ApiClientError, type ApiClient } from "@/lib/api/client";

/** 一覧は全件取得の簡易実装（仮置き: テンプレート数は limit 最大値 200 に収まる想定） */
export const TEMPLATES_FETCH_LIMIT = 200;
/** 作成者名の解決に使うユーザー一覧の取得上限（仮置き） */
export const USERS_FETCH_LIMIT = 200;

const templatesResponseSchema = paginatedResponseSchema(templateSchema);
const usersResponseSchema = paginatedResponseSchema(tenantUserSchema);

export function fetchTemplates(
  client: ApiClient,
  signal: AbortSignal,
): Promise<Paginated<Template>> {
  return client.request(
    `/templates?limit=${TEMPLATES_FETCH_LIMIT}&offset=0`,
    templatesResponseSchema,
    {
      signal,
    },
  );
}

/** 作成者表示用のユーザー一覧（GET /users は全員可 — shared/users.ts） */
export function fetchTenantUsers(
  client: ApiClient,
  signal: AbortSignal,
): Promise<Paginated<TenantUser>> {
  return client.request(`/users?limit=${USERS_FETCH_LIMIT}&offset=0`, usersResponseSchema, {
    signal,
  });
}

export function createTemplate(client: ApiClient, body: CreateTemplateRequest): Promise<Template> {
  return client.request("/templates", templateSchema, { method: "POST", body });
}

export function updateTemplate(
  client: ApiClient,
  templateId: string,
  body: UpdateTemplateRequest,
): Promise<Template> {
  return client.request(`/templates/${templateId}`, templateSchema, { method: "PATCH", body });
}

export function deleteTemplate(client: ApiClient, templateId: string): Promise<void> {
  return client.requestVoid(`/templates/${templateId}`, { method: "DELETE" });
}

/** 操作エラーのトースト文言（サーバー生メッセージは出さず参照 ID を添える — ui-spec 4.3） */
export function mutationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.requestId !== null) {
    return `${fallback}（参照 ID: ${error.requestId}）`;
  }
  return fallback;
}
