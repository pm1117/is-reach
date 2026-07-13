# is-reach PR 分割計画

- ステータス: **承認済み（2026-07-13、Mika Suzuki）**
- フェーズ: 4（PR 分割計画）
- 担当: orchestrator（`is-reach-orchestrator` skill。architect / feature-dev への委譲なし）
- 前提（すべて承認済み）:
  - `docs/requirements.md`
  - `docs/basic-design.md`（2026-07-13 承認）
  - `docs/design-detail.md`（2026-07-13 承認）
  - `docs/ui-spec.md`（2026-07-13 承認）
- 出発点: `docs/agent-driven-development.md` 7 章および `is-reach-orchestrator` skill の PR0〜PR7 表。本書はそれをこのリポジトリの現状と承認済み設計に合わせて調整したもの。
- 本書は**分割計画のみ**を扱う。実装コード・DDL・プロンプト全文は含めない。設計内容は各設計書の章番号・決定番号（D1〜D8 / E1〜E17 / U1〜U9）への参照で示す。
- 本書でも確定事項を「**決定**」、未確定を「**仮置き**」と区別する。

---

## 1. パッケージ境界と依存関係の要約（参照のみ）

basic-design 2 章（決定 D7）のとおり:

```
apps/web        Next.js 管理画面（DB 直接アクセス・LLM 直接呼び出し禁止）
apps/api        API サーバー + ジョブワーカー（LLM 直接呼び出し禁止 = prompt 経由）
packages/shared 型契約の唯一の置き場（実行時 I/O なし・他パッケージへ依存しない）
packages/crawler 外部 HTTP アクセスの唯一の実装点
packages/analysis スクリーニング（LLM 不使用）+ 深掘り前処理・分析統括
packages/prompt  Claude API 呼び出し・インジェクション対策の唯一の実装点
```

- 依存ルール: **apps → packages のみ**。全 packages は **shared にのみ**依存可。packages 同士の横依存・packages → apps の逆流は禁止（組み合わせは `apps/api` ワーカーが行う）。
- したがって PR の依存の向きは次で固定する（**決定** — この向きを崩す PR は作らない）:

```
shared(PR1) → crawler(PR2) / analysis(PR3) / prompt(PR4) → api(PR5a/5b) → web(PR6a/6b) → e2e(PR7)
```

---

## 2. PR 分割一覧（このリポジトリ向け調整 — 決定案）

ガイド 7 章の PR0〜PR7 を基に、次の 2 点を調整する。

1. **PR0 の縮小**: `.claude/skills/`・`.claude/agents/`・`CLAUDE.md` は既にリポジトリに存在し、GitHub Actions の 2 workflow（対話型 `claude.yml` + 自動レビュー `claude-code-review.yml`）も PR #1 で導入済み・`ANTHROPIC_API_KEY` secret 設定済み（2026-07-13 確認）。PR0 の残作業は **review workflow の権限修正（`pull-requests: write` 不足 — agent-driven-development 4 章の既知の詰まり）と `CLAUDE.md` への自動レビュー運用の追記**のみに縮小する。
2. **PR5 / PR6 のサブ分割**（2026-07-13 人間合意済み）: PR5 → 5a（DB 基盤）/ 5b（API + パイプライン接続）、PR6 → 6a（web 基盤）/ 6b（業務画面）。番号体系 PR0〜PR7 は維持する。

| PR | 1 関心事 | 主担当 | 依存 |
|----|----------|--------|------|
| PR0 | GitHub 自動レビュー基盤の整備（既存 workflow の権限修正 + CLAUDE.md 追記） | 基盤（orchestrator 主導） | なし |
| PR1 | モノレポ土台 + `packages/shared` 型契約 | feature-dev | なし（PR0 と独立。ただしレビュー体制のため PR0 先行を推奨） |
| PR2 | `packages/crawler` | feature-dev | PR1 |
| PR3 | `packages/analysis` | feature-dev | PR1（PR2/PR4 と並行可） |
| PR4 | `packages/prompt`（**注入対策必須**） | feature-dev + reviewer | PR1（PR2/PR3 と並行可） |
| PR5a | DB 基盤（マイグレーション・RLS・pg-boss） | feature-dev | PR1 |
| PR5b | `apps/api` パイプライン接続 | feature-dev | PR2 + PR3 + PR4 + PR5a |
| PR6a | `apps/web` 基盤（トークン・ui/ 層・認証・レイアウト） | feature-dev（ui-designer 方針準拠） | PR1（PR5b と並行可） |
| PR6b | 業務画面 S1〜S9 | feature-dev | PR5b + PR6a |
| PR7 | E2E + 運用ドキュメント | 全体 | PR0〜PR6b すべて |

- PR2 / PR3 / PR4 / PR5a / PR6a は相互に独立しており、PR1 マージ後に並行着手できる。

---

## 3. 各 PR の詳細

受け入れ条件の共通部分（全実装 PR に適用 — 決定案）:

1. 該当する設計書の決定番号に適合していること（各 PR の表に明記）
2. テストが green であること（`pnpm test` 等。コマンドは PR1 で確定し CLAUDE.md に追記）
3. ローカル reviewer レビュー → GitHub Claude 自動レビューを通過し、指摘に対応済みであること
4. 人間がレビューしてマージすること（マージゲート）

以下、各 PR の固有事項。

### PR0: GitHub 自動レビュー基盤

| 項目 | 内容 |
|------|------|
| 目的 | 以降の全実装 PR に Claude 自動レビューを効かせる（マージゲートの整備） |
| 含むパス | `.github/workflows/claude-code-review.yml`（`pull-requests: write` 権限の追加修正。workflow 自体は PR #1 で導入済み）、`CLAUDE.md`（自動レビュー運用の追記） |
| 含まないパス | `.claude/skills/`・`.claude/agents/`（既存のため対象外。変更する場合は CLAUDE.md 対応表と同一 PR で更新するルールに従う）、apps/・packages/ 一切 |
| 依存 | なし |
| 受け入れ条件 | Claude GitHub App 導入済み・`ANTHROPIC_API_KEY` secret 設定済み（2026-07-13 確認済み）。review workflow に `pull-requests: write` があること。実 PR で自動レビューコメントが付くことを人間が確認 |
| 主なテスト観点 | workflow の動作確認のみ（コードなし）。レビュー観点（インジェクション・型安全・パッケージ境界）が CLAUDE.md 経由で効いていること |

### PR1: モノレポ土台 + `packages/shared`

| 項目 | 内容 |
|------|------|
| 目的 | pnpm workspace + Turborepo の土台と、型契約の唯一の置き場（shared）の確立 |
| 含むパス | ルート設定（`pnpm-workspace.yaml`・`turbo.json`・tsconfig/lint/test 基盤）、`packages/shared/`（zod スキーマ→型導出 — E17、enum 群: `Role`/`EntryStatus`/`SignalKind`/ジョブ状態/`WarningCode`/`ErrorCode`（design-detail 2.3/2.5）、`UntrustedText` 型（design-detail 3.3）、キュー抽象の型契約 — D5、`ApiError` 標準形） |
| 含まないパス | `packages/crawler`・`analysis`・`prompt` の実装、apps/、DB マイグレーション。**shared に実行時 I/O（HTTP/DB/LLM）を入れない**（basic-design 2.1） |
| 依存 | なし |
| 受け入れ条件 | design-detail 2.3 の型契約が zod スキーマとして揃い型が導出できる。ビルド・lint・テストのコマンドが確定し **CLAUDE.md に追記済み**（CLAUDE.md の更新ルール）。依存方向 lint（packages 横依存・逆流禁止）の仕組みが入っている |
| 主なテスト観点 | zod スキーマの正常系/異常系（enum 外値・必須欠落の拒否）。`UntrustedText` が出典 URL 必須であること（basic-design 8.2 の型レベル強制） |

### PR2: `packages/crawler`

| 項目 | 内容 |
|------|------|
| 目的 | 外部 HTTP アクセスの唯一の実装点（シグナル収集バッチ + 深掘りフェッチ） |
| 含むパス | `packages/crawler/**`（robots.txt 遵守 — E10、レート制限・節度の具体値 — E12、HTTP エラー分類 → `FetchErrorKind` — E10、リダイレクト/タイムアウト/サイズ上限、HTML→プレーンテキスト抽出、User-Agent — E12） + テスト |
| 含まないパス | DB 書き込み（永続化は呼び出し側 = api）、LLM 呼び出し、サニタイズ S1〜S5（prompt の責務 — design-detail 3.3 の二重適用方針）、収集シードの具体リスト（仮置き — PR5b 着手前に人間確認） |
| 依存 | PR1 |
| 受け入れ条件 | design-detail 4.2 の分類表どおりに全 `FetchErrorKind` を返す。robots.txt 拒否は永続スキップ・robots 取得不能時は保守的に停止（E10）。E12 の具体値（最小間隔 10 秒 + ジッター・同一ドメイン 1 接続・全体 5 接続・20 ページ/5 ページ上限）が設定として実装済み |
| 主なテスト観点 | robots 拒否・robots 取得不能時の停止 / 429 の Retry-After 待機 + 間隔 2 倍化 + 再 429 での打ち切り / リダイレクト 3 回上限 / 2MB 超スキップ / レート制限が機械的等間隔にならない（ジッター）こと。外部アクセスはモックで検証 |

### PR3: `packages/analysis`

| 項目 | 内容 |
|------|------|
| 目的 | スクリーニング（フィルタ + ルールベーススコア）と深掘りの前処理・分析統括ロジック |
| 含むパス | `packages/analysis/**` + テスト（検索条件 → フィルタ/スコア（**LLM 不使用** — 要件 F1）、マッチ根拠の組み立て、深掘り収集結果の前処理・ソース優先度順の整理 — design-detail 3.3 S5 の優先度） |
| 含まないパス | 外部サイトへの直接アクセス、LLM API 直接呼び出し（prompt 経由の統括は PR5b のワーカーで結線）、DB アクセス |
| 依存 | PR1（PR2/PR4 と並行可） |
| 受け入れ条件 | ScreeningSearchRequest/Response（design-detail 2.3）の契約でフィルタ・スコア・マッチ根拠を返す。LLM を import していないこと（依存グラフで検証可能） |
| 主なテスト観点 | 属性・シグナル条件の組み合わせ / 鮮度（freshWithinDays）境界 / スコアの決定性（同入力同スコア）/ マッチ根拠が必ず付くこと（要件 F1 受け入れ条件 2） |

### PR4: `packages/prompt`（注入対策必須）

| 項目 | 内容 |
|------|------|
| 目的 | Claude API 呼び出しとプロンプトインジェクション対策の唯一の実装点 |
| 含むパス | `packages/prompt/**` + テスト（LLM 抽象層 + モデル ID 環境設定 — E2、サンドイッチ構造のプロンプト組み立て — E6、`external_data` タグ生成 — E6、サニタイズ S1〜S5 — E7、出力検証 V1〜V6 — E8、LLM リトライ/タイムアウト — E11、注入検知パターン集 — design-detail 3.5 V5） |
| 含まないパス | 外部サイトへの直接アクセス、DB アクセス、プロンプト以外の業務ロジック |
| 依存 | PR1（公開 API は `UntrustedText` 型でのみ外部由来テキストを受け取る — design-detail 3.3） |
| 受け入れ条件 | E6/E7/E8/E11 適合。公開 API が信頼済み/信頼境界外を型で区別（basic-design 5 処理要点 1）。**ローカル reviewer による V1〜V6 観点のレビューを必須**とする（design-detail 3.5。reviewer チェックリストに含める） |
| 主なテスト観点 | **S3 エスケープ後に本文中の `</external_data>`・偽開始タグがタグとして成立しないこと** / S1〜S2（不可視文字・双方向制御文字の除去）/ S4〜S5 の切り詰めと `truncated` 付与・優先度順の除外記録 / V1 失敗 → 1 回再試行 → `LLM_OUTPUT_INVALID` / V2〜V6 の各警告発火（骨子欠落・文字数超過・URL 混入・タグ様文字列・命令調フレーズ反映・出所不明 URL の除去）/ 代表的な注入ペイロード（「これまでの指示を無視」等）をデータブロックに入れた場合の非追従（モック LLM + 検証ロジックで確認） |

### PR5a: DB 基盤（マイグレーション・RLS・pg-boss）

| 項目 | 内容 |
|------|------|
| 目的 | Supabase Postgres のスキーマ・テナント分離（RLS）・ジョブ基盤の確立 |
| 含むパス | マイグレーション一式（置き場は **仮置き: `supabase/migrations/`** — PR5a 着手時に確定）: 全テーブル（basic-design 3 章 + `deep_dive_jobs` — E9）、インデックス — E15、RLS ポリシー + `FORCE ROW LEVEL SECURITY` — E14、DB ロール `app_user`/`app_batch` と権限（`audit_logs` の追記専用強制含む — E14）、ListEntry 起点の `ON DELETE CASCADE` — E4、pg-boss 用スキーマ `pgboss` — E1 |
| 含まないパス | API エンドポイント・ワーカー実装（PR5b）、pg_trgm インデックス（仮置き — 実測後）、DDL 以外のアプリコード |
| 依存 | PR1（enum 定義との整合） |
| 受け入れ条件 | E14/E15 適合。マイグレーションが空 DB から再現可能。`service_role` をテナントデータのクエリに使わない規約がドキュメント化されている |
| 主なテスト観点 | **RLS fail-closed**（`app.tenant_id` 未設定で全行不可）/ 他テナント越境の遮断（SELECT/UPDATE/DELETE）/ `FORCE RLS` が所有者にも効くこと / `audit_logs` への UPDATE/DELETE が権限エラーになること / `anon`・`authenticated` ロールからテナント資産へアクセス不可 / CASCADE 削除で Dossier・Message・収集データが消え、`audit_logs`（非 FK）が残ること |

### PR5b: `apps/api` パイプライン接続

| 項目 | 内容 |
|------|------|
| 目的 | API サーバー + ジョブワーカーで crawler / analysis / prompt を結線し、全 API 契約を実装する |
| 含むパス | `apps/api/**` + テスト: Hono、Supabase Auth JWT 検証 → テナントコンテキスト → 認可ミドルウェア（design-detail 2.4 マトリクス — E3 含む）、全エンドポイント（design-detail 2.2 — E5）、エラー標準形（2.5）、深掘り/メッセージ生成ジョブ（状態機械・リトライ・タイムアウト — E9/E13）、シグナル収集バッチの結線（頻度は仮置き: 日次深夜帯）、監査ログ記録（7 章 — E16）、PII 削除 API — E4、RLS 接続規約（トランザクション + `set_config` — E14 のアプリ側） |
| 含まないパス | 画面（web）、crawler/analysis/prompt の内部変更（必要ならそれぞれのパッケージへの独立 PR）、収集シードの具体リスト（着手前に人間確認 — 仮置き）、API レート制限の具体値確定（実装時計測 — 仮置きのまま実装) |
| 依存 | PR2 + PR3 + PR4 + PR5a |
| 受け入れ条件 | E5/E9/E13/E16 適合。認可マトリクス 2.4 の全行がテストで担保。監査ログのイベント網羅（7.1 の全 event_type）。LLM 呼び出しが prompt 経由のみであること（依存グラフ検証） |
| 主なテスト観点 | 認可マトリクス全パターン（管理者/メンバー × 各操作グループ、E3 のテンプレート変更 403）/ 他テナントリソースの **404 正規化** / 実行中ジョブへの再投入 `JOB_ALREADY_RUNNING`（409）/ 深掘り状態機械の全遷移（部分失敗 → analyzing 継続、全失敗 → `CRAWL_ALL_FAILED`、failed → retry で queued）/ PII 削除のカスケード結果件数と `pii.deleted` 監査ログ（内容は残さない — E4）/ 警告付き生成の `message.generated` metadata |

### PR6a: `apps/web` 基盤

| 項目 | 内容 |
|------|------|
| 目的 | 管理画面の土台（デザイントークン・汎用コンポーネント・認証・レイアウト） |
| 含むパス | `apps/web/**` のうち: Next.js App Router 骨格 + ルーティング確定（ui-spec 2.2 の URL 案を確定 — 仮置き解消）、Tailwind セマンティックトークン — U4（**実値は本 PR で仮値を提示し承認を経て調整** — ui-spec 3.3）、`components/ui/` 汎用層 + **`SafeText` / `ExternalLink`** — U3/U8、レイアウト（サイドナビ・ページヘッダー — U1）、S0 ログイン/招待受諾、状態表現部品（Loading/Empty/Error/Forbidden — U5）、API クライアント（shared の型契約使用） |
| 含まないパス | 業務画面 S1〜S9（PR6b）、feature/ 層、DB 直接アクセス・LLM 呼び出し（禁止 — basic-design 2.1） |
| 依存 | PR1（API 結合は PR6b で行うため PR5b と並行可） |
| 受け入れ条件 | U1/U3/U4/U5/U8 適合。raw カラー直接使用禁止が lint 等で担保。`ExternalLink` が `rel="noopener noreferrer"` + 外部アイコン + ホスト名表示 + 危険スキーム排除を満たす。カラー実値の承認（本 PR 内の承認ポイント） |
| 主なテスト観点 | `SafeText` が HTML を解釈しないこと（**`dangerouslySetInnerHTML` 不使用はレビュー必須観点** — ui-spec 7 章）/ `ExternalLink` の `javascript:` 等スキームのプレーンテキストフォールバック / ForbiddenState への URL 直打ち遷移 |

### PR6b: 業務画面 S1〜S9

| 項目 | 内容 |
|------|------|
| 目的 | 業務フロー一本道（検索 → リスト → 深掘り → ドシエ → 生成 → 編集 → コピー → ステータス）の画面実装 |
| 含むパス | `apps/web/src/features/**` + 各 route: S1 ダッシュボード（3 ブロック簡易版 — U2）、S2 スクリーニング、S3/S4 リスト、S5 企業詳細（根拠なしバッジ必須 — 要件 F3）、S6 メッセージ編集（骨子/AI 生成の視覚区別・警告バナー・警告付きコピー確認ダイアログ・手動送信文言 — U7）、S7 テンプレート、S8 設定、S9 監査ログ、非同期ジョブ UX（フェーズ表示 + ポーリング。間隔は design-detail E13 の 2/3/10 秒を正とする — U6）、ロール別非表示 — U9 |
| 含まないパス | ui/ 層の大規模変更（必要なら PR6a 側の追補 PR）、API 側の変更、feature 間の相互 import（禁止 — U3） |
| 依存 | PR5b + PR6a |
| 受け入れ条件 | U2/U6/U7/U9 適合 + ui-spec 4 章の状態（ローディング/空/エラー/権限なし）が全画面で定義済み。外部由来テキスト表示がすべて `SafeText`/`ExternalLink` 経由（ui-spec 7 章 — レビュー必須観点） |
| 主なテスト観点 | 警告付きメッセージのコピー確認ダイアログ（U7）/ コピー後のステータス自動更新が**行われない**こと（提案のみ）/ 「送信」ボタンが存在しないこと（文言方針 6.5）/ メンバーでのテンプレート変更 UI 非表示・URL 直打ちで ForbiddenState / 深掘り failed 行の再実行導線 / ポーリングが全ジョブ終了で停止すること |

### PR7: E2E + 運用ドキュメント

| 項目 | 内容 |
|------|------|
| 目的 | 主業務フローの端到端検証と運用引き継ぎ資料 |
| 含むパス | E2E テスト（ツール選定は着手時に提案 — **仮置き: Playwright**。置き場 仮置き: `e2e/`）: 検索 → リスト保存 → 深掘り → ドシエ → 生成 → 編集 → コピー → ステータス更新の一本道 + 管理者/メンバーの権限差分。運用ドキュメント（`docs/operations.md` 等）: デプロイ手順（web = Vercel / api+ワーカー = 常駐 Node — E1）、収集シードの運用・人間確認手順、共有資産 PII 削除の運用スクリプト手順（design-detail 2.2 仮置き）、監査ログ保持バッチ（1 年 / pii.deleted 3 年 — E16）、User-Agent 連絡先の設定手順 |
| 含まないパス | 新機能・画面追加、既存パッケージの仕様変更 |
| 依存 | PR0〜PR6b すべて。**前提: 常駐 Node の載せ先（Railway / Render 等）を着手前までに人間が決定**（仮置き継続 — 2026-07-13 合意） |
| 受け入れ条件 | E2E が CI で green。運用ドキュメントに上記 4 点 + ホスティング決定内容が反映済み |
| 主なテスト観点 | 一本道フローの成功系 / 深掘り失敗 → 再実行の復帰系 / メンバーロールでの権限制限（403/非表示）/ 警告付きメッセージの確認ダイアログ経由コピー |

---

## 4. 決定・仮置き → PR 対応表

### 4.1 詳細設計の決定 E1〜E17 → PR

| # | 決定（design-detail 8 章） | 実装 PR |
|---|---------------------------|---------|
| E1 | Supabase / Vercel / 常駐 Node / pg-boss 同居 | PR5a（DB・pg-boss）+ PR7（デプロイ手順。載せ先は仮置き → PR7 前に決定） |
| E2 | LLM モデル用途別・環境設定値 | PR4（抽象層・設定）|
| E3 | テンプレート権限 | PR5b（認可）+ PR6b（表示制御） |
| E4 | PII 即時物理削除 | PR5a（CASCADE 構造）+ PR5b（API・監査ログ） |
| E5 | API 契約 | PR1（shared 型契約）+ PR5b（実装） |
| E6 | プロンプト構造（サンドイッチ・external_data タグ） | PR4 |
| E7 | サニタイズ S1〜S5 | PR4 |
| E8 | 出力検証 V1〜V6 | PR4（`WarningCode` enum は PR1） |
| E9 | 深掘りジョブ詳細（専用レコード・部分失敗許容） | PR5b（テーブルは PR5a） |
| E10 | クローリングエラー処理 | PR2 |
| E11 | LLM リトライ | PR4 |
| E12 | クローリング節度の具体値 | PR2 |
| E13 | メッセージ生成非同期 + ポーリング間隔（2/3/10 秒） | PR5b（ジョブ）+ PR6b（ポーリング UI） |
| E14 | RLS 実装方式 | PR5a（ポリシー・ロール）+ PR5b（`set_config` 接続規約） |
| E15 | インデックス方針 | PR5a |
| E16 | 監査ログ（網羅・属性・保持） | PR5a（テーブル・追記専用権限）+ PR5b（記録実装）+ PR7（保持バッチ運用） |
| E17 | zod を shared に集約 | PR1 |

### 4.2 UI 仕様の決定 U1〜U9 → PR

| # | 決定（ui-spec 9 章） | 実装 PR |
|---|----------------------|---------|
| U1 | レイアウト（サイドナビ・情報密度） | PR6a |
| U2 | 画面構成 S0〜S9（S1 は簡易版 MVP） | PR6a（S0）+ PR6b（S1〜S9） |
| U3 | コンポーネント 2 層・feature 間 import 禁止 | PR6a（ui/ 層・規約）+ PR6b（feature/ 層） |
| U4 | Tailwind セマンティックトークン | PR6a（実値仮値の提示・承認込み） |
| U5 | 状態表現の標準 | PR6a（部品）+ PR6b（全画面適用） |
| U6 | 非同期ジョブ UX（フェーズ表示・ポーリング） | PR6b |
| U7 | メッセージ編集画面 | PR6b |
| U8 | 外部由来テキスト表示原則（SafeText / ExternalLink） | PR6a（部品）+ PR6b（適用。レビュー必須観点） |
| U9 | ロール別表示制御 | PR6b |

### 4.3 残仮置きの決定期限 → PR

| 仮置き（出典） | 決定期限 | 決定者 |
|----------------|----------|--------|
| 常駐 Node の載せ先（design-detail 8 章） | **PR7 着手前**（2026-07-13 合意: 仮置き継続） | 人間 |
| シグナル収集の頻度・シードリスト（design-detail 8 章） | PR5b の収集バッチ着手前（初期シードリストを提示し人間確認） | 人間 |
| User-Agent 連絡先（design-detail 8 章） | 運用開始前（PR7 の運用ドキュメントに設定手順を記載） | 人間 |
| API レート制限の具体値（design-detail 8 章） | PR5b 実装時に計測して設定 | feature-dev 提案 → 人間 |
| pg_trgm 本文検索（design-detail 6.2） | 実装フェーズの実測後（PR5a では定義しない） | 人間 |
| 共有資産 PII 削除の運用手順（design-detail 2.2） | PR7（運用スクリプト + 手順書） | 人間確認 |
| 監査ログのアーカイブ方式（design-detail 7.3） | 運用開始前（PR7 ドキュメントに判断事項として記載） | 人間 |
| ログインイベント取得方式（design-detail 5 章） | PR5b 実装時（Supabase Auth Hooks 第一候補） | feature-dev 提案 → 人間 |
| URL パス構成・日時フォーマット（ui-spec 9 章） | PR6a で確定 | feature-dev 提案 → 人間 |
| カラー実値・派生構造（ui-spec 9 章） | PR6a 内で仮値提示 → 承認 | 人間 |
| ページネーション件数・表示行数・「保存してコピー」動線・骨子編集時の扱い（ui-spec 9 章） | PR6b 実装時 | feature-dev 提案 → 人間 |
| **リスト削除権限（設計書間の不整合 → 6 章）** | **PR5b 着手前** | 人間 |
| マイグレーション置き場・E2E ツール（本書 3 章） | 各 PR（PR5a / PR7）着手時 | feature-dev 提案 → 人間 |

---

## 5. 実装 PR の共通フロー（参照）

agent-driven-development 7 章のとおり:

1. feature-dev が実装（該当 skill: `subagent-driven-development`）
2. ローカル reviewer で一度レビュー（skill: `reviewer-agent`）
3. PR 作成 → GitHub Claude 自動レビュー（PR0 の workflow）
4. 指摘修正 → **人間がマージ**

レビュー必須観点の強調（決定案）:

- **PR4**: 出力検証 V1〜V6・サニタイズ S1〜S5・注入非追従（design-detail 3.5 — reviewer チェックリスト必須）
- **PR5a / PR5b**: RLS fail-closed・越境遮断・認可マトリクス（design-detail 2.4 / 6.1）
- **PR6a / PR6b**: ui-spec 7 章全項目（`dangerouslySetInnerHTML` 禁止・SafeText/ExternalLink 集約）

---

## 6. 申し送り: 設計書間の軽微な不整合（要決定 — 本書では決めない）

| # | 事項 | 内容 | 決定期限 |
|---|------|------|----------|
| 1 | リスト削除権限 | design-detail 2.2 は `DELETE /lists/:listId` を「全員」、ui-spec 2.2/8 章は「仮置き: 作成者 + 管理者」。**PR5b（認可）・PR6b（表示）着手前に人間が確定**し、確定側の文書を修正する | PR5b 着手前 |
| 2 | ポーリング間隔 | ui-spec の仮置き 5 秒に対し design-detail E13 が 2 秒（生成）/ 3 秒（深掘り詳細）/ 10 秒（一覧）で確定済み。**design-detail を正とする**（ui-spec 側は E13 参照に読み替え） | 対応済み（本書の読み替えで解消） |

---

## 7. 承認

- [x] 本 PR 分割計画の承認（承認者: Mika Suzuki、2026-07-13）
- [x] （確認）前フェーズ `docs/design-detail.md` / `docs/ui-spec.md` が承認済みであること（2026-07-13 承認済み）
- [ ] リスト削除権限（6 章 #1）の確定方針の指示（**保留中** — PR5b 着手前までに決定）

承認後、フェーズ5（実装）に着手する。実装は PR0 → PR1 から順に、本書 2 章の依存関係に従って進める（人間承認前に実装 PR には着手しない）。
