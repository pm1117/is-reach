// ESLint 設定（flat config）。全 workspace 共通でルートから一括 lint する。
import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// --- apps/web 固有の禁止ルール（ui-spec 7 章 — U8 / 3.3 — U4。レビュー必須観点） ---

// Tailwind 既定パレット名（raw カラー）。セマンティックトークン（primary/danger/warning/
// success/neutral）のみ使用可のため、クラス文字列での raw カラー使用を禁止する（U4）。
// neutral はセマンティックトークンとして再定義済みのため除外。
// globals.css 側でも `--color-*: initial` により raw カラーユーティリティ自体を消している（二重の担保）。
const RAW_COLOR_CLASS_PATTERN =
  "(?:^|[\\s\"'`:(!])(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|placeholder|caret|accent|decoration|shadow)-(?:(?:slate|gray|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}|white|black)(?![\\w-])";

// 任意値カラー（bg-[#ff0000] 等）も禁止（トークン定義は globals.css の @theme に集約する）
const ARBITRARY_COLOR_CLASS_PATTERN =
  "(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|placeholder|caret|accent|decoration|shadow)-\\[#";

const RAW_COLOR_MESSAGE =
  "raw カラー（red-500 等）の直接使用は禁止（ui-spec 3.3 — U4）。セマンティックトークン（primary/danger/warning/success/neutral）を使う";

/** dangerouslySetInnerHTML と raw カラーの禁止（apps/web 全ファイル共通） */
const webRestrictedSyntaxRules = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message:
      "dangerouslySetInnerHTML は使用禁止（ui-spec 7 章 — U8）。外部由来テキストは SafeText でプレーンテキスト表示する",
  },
  {
    selector: "Property[key.name='dangerouslySetInnerHTML']",
    message:
      "dangerouslySetInnerHTML は使用禁止（ui-spec 7 章 — U8）。外部由来テキストは SafeText でプレーンテキスト表示する",
  },
  {
    selector: `Literal[value=/${RAW_COLOR_CLASS_PATTERN}/]`,
    message: RAW_COLOR_MESSAGE,
  },
  {
    selector: `TemplateElement[value.raw=/${RAW_COLOR_CLASS_PATTERN}/]`,
    message: RAW_COLOR_MESSAGE,
  },
  {
    selector: `Literal[value=/${ARBITRARY_COLOR_CLASS_PATTERN}/]`,
    message: RAW_COLOR_MESSAGE,
  },
  {
    selector: `TemplateElement[value.raw=/${ARBITRARY_COLOR_CLASS_PATTERN}/]`,
    message: RAW_COLOR_MESSAGE,
  },
];

/** 素の <a> の禁止（外部リンク規則 rel/target/アイコン/URL 表示を ExternalLink に集約するため） */
const rawAnchorRule = {
  selector: "JSXOpeningElement[name.name='a']",
  message:
    "素の <a> は使用禁止。アプリ内遷移は next/link の Link、外部 URL は ExternalLink を使う（ui-spec 7 章 — U8）",
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      ".firecrawl/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // any 禁止（CLAUDE.md / feature-dev skill の必須要件）
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      // `_` 接頭辞は意図的な未使用（rest 分離による必須欠落テスト等）として許可
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // apps/web: ブラウザ環境 + 表示セキュリティ規則（ui-spec 7 章）+ トークン規約（3.3）
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "no-restricted-syntax": ["error", ...webRestrictedSyntaxRules, rawAnchorRule],
    },
  },
  {
    // ExternalLink 本体のみ <a> の使用を許可する（外部リンク規則の唯一の実装点）
    files: ["apps/web/src/components/ui/external-link.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...webRestrictedSyntaxRules],
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
