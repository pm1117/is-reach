# Skills Index

人間向けの索引です。Claude はこのファイルを自動では読み込みません（skill 本体は `.claude/skills/<name>/SKILL.md`）。

## Skills

| Skill | 使うタイミング | 成果物 |
|-------|----------------|--------|
| `software-architecture` | 要件定義・基本設計・詳細設計・データモデル | `docs/requirements.md` / `docs/basic-design.md` / `docs/design-detail.md` |
| `frontend-design` | 画面・UI 方針 | `docs/ui-spec.md` |
| `subagent-driven-development` | 実装・型・エラー処理・テスト | コード + テスト |
| `reviewer-agent` | PR レビュー・品質・セキュリティ検証 | レビューコメント |
| `is-reach-orchestrator` | フェーズ進行・役割委譲・PR 分割 | `docs/pr-plan.md` など |

## Subagents（`.claude/agents/`）

| Agent | 対応 Skill | 実装コード |
|-------|-----------|------------|
| `architect` | software-architecture | 禁止（docs のみ） |
| `ui-designer` | frontend-design | 原則禁止（方針・仕様まで） |
| `feature-dev` | subagent-driven-development | 許可 |
| `reviewer` | reviewer-agent | 禁止（指摘のみ） |

## 使い方の例

```text
orchestrator に従って進めて。まず Architect で要件定義。実装は禁止。
成果物は docs/requirements.md。終わったら私の承認を待つ。
```

運用ルール: skill / agent を追加・改名したら、同じ PR / 同じコミットで `CLAUDE.md` の対応表とこのファイルを更新する。
