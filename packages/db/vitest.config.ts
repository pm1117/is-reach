// DB テスト（実 Postgres）の vitest 設定。
// - globalSetup が Docker で Postgres 16 を起動し、supabase/migrations/ を適用する。
// - テストは共有の 1 コンテナに対して実行するため、ファイル間の干渉を避けて直列実行する
//   （各テストはランダム UUID のテナントを自前で用意するが、決定性を優先）。
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
