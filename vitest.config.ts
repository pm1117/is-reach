// ルート直下の vitest 設定。tools/ 配下のスクリプトのテストのみを対象とする
// （各 workspace のテストは turbo 経由で各パッケージの vitest が実行する）。
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tools/**/*.test.mjs"],
  },
});
