// supabase/migrations/ の SQL ファイルを順に適用するユーティリティ。
// globalSetup（初回適用）と migrations.test.ts（空 DB からの再現性検証）の両方から使う。
// vitest に依存しない純粋モジュール。
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";

/** リポジトリルート（このファイルは packages/db/test/ 配下にある前提） */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** マイグレーション置き場（Supabase CLI 規約 — PR5a 決定事項） */
export const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

/**
 * マイグレーションファイルの一覧をファイル名昇順（= タイムスタンプ順）で返す。
 * 1 件もない場合はテスト前提の崩れとしてエラーにする（fail-closed）。
 */
export function listMigrationFiles(): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`マイグレーションが見つからない: ${MIGRATIONS_DIR}`);
  }
  return files;
}

/**
 * 全マイグレーションを順に適用する。各ファイルは複数文を含むため、
 * node-postgres の simple query（パラメータなし query()）で 1 ファイル = 1 回実行する。
 * 失敗時はどのファイルで失敗したかを含めて投げ直す。
 */
export async function applyMigrations(client: Client): Promise<string[]> {
  const files = listMigrationFiles();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await client.query(sql);
    } catch (error) {
      throw new Error(`マイグレーション ${file} の適用に失敗: ${String(error)}`, {
        cause: error,
      });
    }
  }
  return files;
}
