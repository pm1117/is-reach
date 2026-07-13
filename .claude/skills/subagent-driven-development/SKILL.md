---
name: subagent-driven-development
description: >
  各機能（スクレイピング、分析、LLM プロンプト生成）の実装手順。TypeScript 厳密型、エラーハンドリング、テスト。
  Use when 機能実装、コード修正、テスト作成など実装コードを書くとき。
---

# Feature Dev（実装）Skill

is-reach の各機能を実装する。Skills の中で唯一、実装コードを書く役割。

## 前提条件（着手ゲート）

実装に着手してよいのは次がすべて満たされたときのみ:

1. `docs/requirements.md` / `docs/architecture.md` / `docs/detailed-design.md` が人間承認済み
2. `docs/pr-plan.md` で担当 PR のスコープが定義されている

満たされていなければ実装せず、不足しているフェーズを報告する。

## 実装ルール

- **TypeScript 厳密型**: `any` を使わない。外部入力（スクレイピング結果、API レスポンス）は必ずスキーマ検証（例: zod）で型を確定させてから使う。
- **エラーハンドリング**: 失敗しうる処理（ネットワーク、パース、LLM 呼び出し）は例外を握りつぶさず、詳細設計のエラー状態・リトライ方針に従う。
- **パッケージ境界を守る**: 依存の向きは `packages/shared` ← 各 package ← `apps/*`。境界をまたぐ型は `packages/shared` に置く。
- **テスト**: 実装と同じ PR にテストを含める。外部依存（HTTP、LLM API）はモックする。
- **1 PR = 1 関心事**: `docs/pr-plan.md` のスコープを超える変更は行わず、必要なら PR 計画の更新を提案する。

## 必須セキュリティ（packages/prompt ほか）

- スクレイピング結果・外部コンテンツをプロンプトへ組み込む際は、システム指示と外部データを構造的に分離する（外部データを指示として解釈させない）
- 外部コンテンツ由来の文字列をそのままシェル・SQL・HTML に渡さない

## 実装後

ローカルの `reviewer` サブエージェント（reviewer-agent skill）によるレビューを受けてから PR を作成する。
