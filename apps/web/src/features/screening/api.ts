// S2 スクリーニング検索の API ラッパ（design-detail 2.2 — 要件 F1）。
// 契約は @is-reach/shared の zod スキーマで検証する（lib/api/me.ts と同じ流儀）。
import {
  companyListSchema,
  screeningFacetsResponseSchema,
  screeningSearchResponseSchema,
  type CompanyList,
  type CreateListRequest,
  type ScreeningFacetsResponse,
  type ScreeningSearchRequest,
  type ScreeningSearchResponse,
} from "@is-reach/shared";
import type { ApiClient } from "@/lib/api/client";

/** GET /screening/facets — 検索条件の選択肢メタ */
export function fetchScreeningFacets(
  client: ApiClient,
  signal?: AbortSignal,
): Promise<ScreeningFacetsResponse> {
  return client.request("/screening/facets", screeningFacetsResponseSchema, { signal });
}

/** POST /screening/searches — 条件検索（同期・即時応答 — basic-design 4.2） */
export function runScreeningSearch(
  client: ApiClient,
  request: ScreeningSearchRequest,
  signal?: AbortSignal,
): Promise<ScreeningSearchResponse> {
  return client.request("/screening/searches", screeningSearchResponseSchema, {
    method: "POST",
    body: request,
    signal,
  });
}

/**
 * POST /lists — 検索結果からのリスト作成（検索条件スナップショット同梱 — 要件 F1）。
 * リストは lists ドメインの資産だが、feature 間 import は禁止（ui-spec 3.1 — U3）のため
 * screening 側にも薄いラッパを持つ（契約は shared のスキーマで同一）。
 */
export function createCompanyList(
  client: ApiClient,
  request: CreateListRequest,
): Promise<CompanyList> {
  return client.request("/lists", companyListSchema, { method: "POST", body: request });
}
