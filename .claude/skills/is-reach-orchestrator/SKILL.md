---
name: is-reach-orchestrator
description: >
  要件定義 → 基本設計 → 詳細設計 → PR 分割 → 実装のフェーズゲート進行管理。
  Use when プロジェクト全体の進行、次にやるべきフェーズの判断、PR 分割計画、役割への委譲を扱うとき。
---

# is-reach Orchestrator Skill

フェーズゲートを管理し、適切な役割（サブエージェント）へタスクを委譲する。自分では設計も実装もしない。

## フェーズゲート

各フェーズは**人間の承認**を得てから次へ進む。勝手に飛ばさない。

| # | フェーズ | 担当 agent | 成果物 | ゲート |
|---|----------|-----------|--------|--------|
| 1 | 要件定義 | architect | `docs/requirements.md` | 人間が OK |
| 2 | 基本設計 | architect | `docs/architecture.md` | 人間が OK |
| 3 | 詳細設計 | architect + ui-designer | `docs/detailed-design.md` / `docs/ui-spec.md` | 人間が OK |
| 4 | PR 分割計画 | orchestrator（本 skill） | `docs/pr-plan.md` | 人間が OK |
| 5 | 実装 | feature-dev（+ reviewer） | コード + テスト | PR ごとにレビュー・マージ |

現在フェーズの判定: `docs/` 配下の成果物の存在と承認状況を確認する。承認状況が不明なら人間に確認する。

## 役割対応表

| タスク | agent | skill |
|--------|-------|-------|
| 要件・設計・データモデル | architect | software-architecture |
| 画面・UI 方針 | ui-designer | frontend-design |
| 実装・テスト | feature-dev | subagent-driven-development |
| レビュー・品質 | reviewer | reviewer-agent |

## PR 分割方針（1 PR = 1 関心事、依存の向きに沿って切る）

| PR | 内容 |
|----|------|
| PR0 | `.claude/` skills・agents、`CLAUDE.md`、GitHub Actions（レビュー用） |
| PR1 | モノレポ土台（pnpm/turborepo、shared 型） |
| PR2 | `packages/crawler` + テスト |
| PR3 | `packages/analysis` |
| PR4 | `packages/prompt`（プロンプトインジェクション対策必須） |
| PR5 | `apps/api` パイプライン接続 |
| PR6 | `apps/web` 管理画面 |
| PR7 | E2E / 運用ドキュメント |

## 各実装 PR の流れ

1. feature-dev が実装
2. ローカル reviewer で一度レビュー
3. PR 作成 → GitHub Claude 自動レビュー
4. 指摘修正 → 人間がマージ

## 禁止事項

- 要件定義・設計フェーズ中に feature-dev を動かさない
- 人間承認を待たずに次フェーズの成果物を作り始めない
