# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## リポジトリの現状

このリポジトリは初期段階（グリーンフィールド）です。現時点ではコード・ビルド設定・テスト基盤は存在せず、README.md のみがあります。ビルド／リント／テストコマンドは、実装が追加された時点でこのファイルに追記してください。

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

1 PR = 1 関心事。分割計画は `docs/pr-plan.md`（orchestrator skill 参照）。

## セキュリティ上の注意

スクレイピング結果や外部コンテンツを LLM プロンプトに組み込む設計のため、プロンプトインジェクション対策を実装時の必須要件として扱ってください。
