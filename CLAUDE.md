# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## リポジトリの現状

実装フェーズ（フェーズ5）進行中。設計ドキュメント（`docs/requirements.md` → `basic-design.md` → `design-detail.md` / `ui-spec.md` → `pr-plan.md`）は承認済みで、`.claude/`（skills・agents）と GitHub Actions（Claude 自動レビュー）が整備済み。PR1 でモノレポ土台（pnpm workspace + Turborepo）と `packages/shared`（型契約）が導入済み。`packages/crawler` / `analysis` / `prompt`、`apps/web` / `api` は未実装（`docs/pr-plan.md` の PR2 以降）。

## 開発コマンド

pnpm workspace + Turborepo のモノレポ。pnpm のバージョンはルート `package.json` の `packageManager` で固定（corepack 推奨: `corepack pnpm <cmd>` で pinned 版が使われる）。

```bash
pnpm install   # 依存インストール
pnpm build     # 全 workspace のビルド（turbo run build）
pnpm test      # 全 workspace のテスト + tools/ のテスト（typecheck 含む）
pnpm lint      # eslint + prettier --check + 依存方向ルール検証
pnpm lint:deps # 依存方向ルール検証のみ（tools/check-workspace-deps.mjs）
pnpm format    # prettier --write
```

- TypeScript は `tsconfig.base.json`（strict + noUncheckedIndexedAccess 等）を全 workspace が継承する。`any` は ESLint でエラー。
- 依存方向ルール（basic-design 2.2）: `packages/shared` は他 workspace に依存しない / `packages/*` は shared のみ依存可 / apps → packages のみ（逆流・横依存・apps 間依存は禁止）。`pnpm lint` で機械検証される。
- 型契約は zod スキーマとして `packages/shared` に定義し `z.infer` で型を導出する（決定 E17）。shared に実行時 I/O（HTTP / DB / LLM）を追加しない。

## プロジェクト概要（README.md より）

「is-reach」は以下の機能を持つプロダクトとして計画されています:

- スクレイピング、分析、LLM プロンプト生成の各機能
- PC 向け管理画面（Tailwind CSS による高忠実度 UI コンポーネント）
- モノレポ構成を想定

## 開発体制: サブエージェント駆動開発

進め方の詳細は `docs/agent-driven-development.md`、人間向け索引は `docs/SKILLS.md` を参照。

### フェーズゲート

要件定義 → 基本設計 → 詳細設計 → PR 分割計画 → 実装 の順に進め、各フェーズは**人間の承認**を得てから次へ進む（勝手に飛ばさない）。進行管理は `is-reach-orchestrator` skill に従う。

### タスク ↔ agent / skill 対応表

| タスク | Agent（`.claude/agents/`） | Skill（`.claude/skills/`） | 実装コード |
|--------|---------------------------|---------------------------|------------|
| 要件・設計・データモデル・モノレポ境界 | `architect` | `software-architecture` | 禁止（docs のみ） |
| 画面・UI 方針（PC 管理画面、Tailwind） | `ui-designer` | `frontend-design` | 原則禁止 |
| 機能実装・テスト | `feature-dev` | `subagent-driven-development` | 許可 |
| レビュー・品質・セキュリティ検証 | `reviewer` | `reviewer-agent` | 禁止（指摘のみ） |

### PR 分割方針

1 PR = 1 関心事。分割計画は `docs/pr-plan.md`（承認済み。orchestrator skill 参照）。実装 PR は同計画の依存順（shared → crawler/analysis/prompt → api → web → e2e）に従う。

### GitHub 自動レビュー

- PR の作成・更新時に `.github/workflows/claude-code-review.yml` が差分を自動レビューする（マージゲート）。ローカル `reviewer` agent は実装前・実装中のレビューを担当し、役割分担する（`docs/agent-driven-development.md` 4 章）
- PR / Issue コメントで `@claude` をメンションすると対話型 workflow（`.github/workflows/claude.yml`）が応答する
- レビュー観点（プロンプトインジェクション対策・型安全・パッケージ境界）は本ファイルと `reviewer-agent` skill に従う

## セキュリティ上の注意

スクレイピング結果や外部コンテンツを LLM プロンプトに組み込む設計のため、プロンプトインジェクション対策を実装時の必須要件として扱ってください。
