// ブラウザ用 ApiClient のシングルトン。JWT は Supabase Auth セッションから供給する。
import { getPublicEnv } from "../config/env";
import { getSupabaseBrowserClient } from "../supabase/browser-client";
import { ApiClient } from "./client";

let client: ApiClient | null = null;

export function getBrowserApiClient(): ApiClient {
  if (client === null) {
    const env = getPublicEnv();
    client = new ApiClient({
      baseUrl: env.apiBaseUrl,
      getAccessToken: async () => {
        const supabase = getSupabaseBrowserClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        return session?.access_token ?? null;
      },
    });
  }
  return client;
}
