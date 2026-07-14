// 公開環境変数の取得。外部入力（環境変数）は zod で検証してから使う。
// import 時ではなく呼び出し時に検証する（`next build` のプリレンダリングを env なしで通すため。
// NEXT_PUBLIC_* はビルド時にリテラル参照がインライン展開されるので、プロパティ名を変数化しない）。
import { z } from "zod";

const publicEnvSchema = z.object({
  supabaseUrl: z.url({ error: "NEXT_PUBLIC_SUPABASE_URL は URL 形式で指定してください" }),
  supabaseAnonKey: z.string().min(1, { error: "NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です" }),
  apiBaseUrl: z.string().min(1, { error: "NEXT_PUBLIC_API_BASE_URL が未設定です" }),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function getPublicEnv(): PublicEnv {
  const parsed = publicEnvSchema.safeParse({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
  });
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => issue.message).join(" / ");
    throw new Error(`環境変数が不足または不正です: ${details}（apps/web/.env.example を参照）`);
  }
  return parsed.data;
}
