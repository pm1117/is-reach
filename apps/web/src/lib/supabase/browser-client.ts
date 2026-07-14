// Supabase Auth のブラウザクライアント。
// 【重要】supabase-js は Auth（ログイン・招待受諾・セッション/JWT 取得）のみに使う。
// PostgREST 経由のデータアクセス（.from() 等）は禁止 — web のデータアクセスは
// apps/api の HTTP API のみ（basic-design 2.1 / pr-plan PR6a）。
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "../config/env";

let client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (client === null) {
    const env = getPublicEnv();
    client = createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
  }
  return client;
}
