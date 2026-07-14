// S8 テナント設定・ユーザー管理の API 呼び出し（design-detail 2.2 — 要件 F6 / 6.3）。
// 本画面は管理者のみ（ルート側で RequireAdmin — サーバー側認可が本線）。
import {
  deletionResponseSchema,
  paginatedResponseSchema,
  tenantSettingsSchema,
  tenantUserSchema,
  type DeletionRequest,
  type DeletionResponse,
  type InviteUserRequest,
  type Paginated,
  type TenantSettings,
  type TenantUser,
  type UpdateTenantRequest,
  type UpdateUserRoleRequest,
} from "@is-reach/shared";
import { ApiClientError, type ApiClient } from "@/lib/api/client";

/** ユーザー一覧は全件取得の簡易実装（仮置き: テナント内ユーザーは limit 最大値 200 以下想定） */
export const USERS_FETCH_LIMIT = 200;

const usersResponseSchema = paginatedResponseSchema(tenantUserSchema);

export function fetchUsers(client: ApiClient, signal: AbortSignal): Promise<Paginated<TenantUser>> {
  return client.request(`/users?limit=${USERS_FETCH_LIMIT}&offset=0`, usersResponseSchema, {
    signal,
  });
}

export function inviteUser(client: ApiClient, body: InviteUserRequest): Promise<TenantUser> {
  return client.request("/users/invitations", tenantUserSchema, { method: "POST", body });
}

export function updateUserRole(
  client: ApiClient,
  userId: string,
  body: UpdateUserRoleRequest,
): Promise<TenantUser> {
  return client.request(`/users/${userId}`, tenantUserSchema, { method: "PATCH", body });
}

/** 無効化（DELETE /users/:userId — 物理削除ではなく invitation_status='disabled' 化） */
export function disableUser(client: ApiClient, userId: string): Promise<void> {
  return client.requestVoid(`/users/${userId}`, { method: "DELETE" });
}

export function fetchTenant(client: ApiClient, signal: AbortSignal): Promise<TenantSettings> {
  return client.request("/tenant", tenantSettingsSchema, { signal });
}

export function updateTenant(
  client: ApiClient,
  body: UpdateTenantRequest,
): Promise<TenantSettings> {
  return client.request("/tenant", tenantSettingsSchema, { method: "PATCH", body });
}

/** データ削除依頼（決定 E4: 即時物理削除 — 取り消し不可） */
export function requestDeletion(
  client: ApiClient,
  body: DeletionRequest,
): Promise<DeletionResponse> {
  return client.request("/deletion-requests", deletionResponseSchema, { method: "POST", body });
}

/** 操作エラーのトースト文言（サーバー生メッセージは出さず参照 ID を添える — ui-spec 4.3） */
export function mutationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.requestId !== null) {
    return `${fallback}（参照 ID: ${error.requestId}）`;
  }
  return fallback;
}
