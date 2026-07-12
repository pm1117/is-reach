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

README.md では、開発を以下の役割分担で進めることが定義されています。タスクに応じて対応する役割の観点で作業してください:

- **Architect**（software-architecture, brainstorming）: 全体設計、データモデリング、モノレポ構成の定義
- **UI/UX Designer Agent**（frontend-design）: PC 向け管理画面、高忠実度 UI コンポーネント、Tailwind CSS の実装方針策定
- **Feature Dev Agent**（subagent-driven-development）: 各機能（スクレイピング、分析、LLM プロンプト生成）の具体的な実装
- **Reviewer Agent**（GitHub Actions と連携）: コードの品質、型安全、セキュリティ（プロンプトインジェクション対策など）の自動検証

## セキュリティ上の注意

スクレイピング結果や外部コンテンツを LLM プロンプトに組み込む設計のため、プロンプトインジェクション対策を実装時の必須要件として扱ってください。
