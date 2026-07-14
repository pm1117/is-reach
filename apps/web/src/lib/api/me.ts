// GET /me（design-detail 2.2「認証・自身」）。契約は shared の meResponseSchema。
import { meResponseSchema, type MeResponse } from "@is-reach/shared";
import type { ApiClient } from "./client";

export function fetchMe(client: ApiClient): Promise<MeResponse> {
  return client.request("/me", meResponseSchema);
}
