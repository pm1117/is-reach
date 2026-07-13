#!/usr/bin/env node
// workspace の package.json を走査し、依存方向ルール（basic-design 2.2）違反を検出する CLI。
// 違反があれば一覧を表示して exit 1。`pnpm lint` / `pnpm lint:deps` から実行される。
// 既知の制限: シンボリックリンクで workspace ルート外を指すディレクトリは考慮しない
// （このリポジトリでは使用しない前提）。
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectWorkspaceViolations,
  mergeDependencies,
  parseWorkspaceRoots,
} from "./workspace-rules.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// workspace ルートは pnpm-workspace.yaml から導出する（手動同期をなくす）
const workspaceYamlPath = join(repoRoot, "pnpm-workspace.yaml");
if (!existsSync(workspaceYamlPath)) {
  console.error("✖ pnpm-workspace.yaml が見つからない");
  process.exit(1);
}
const { roots: workspaceRoots, errors: parseErrors } = parseWorkspaceRoots(
  readFileSync(workspaceYamlPath, "utf8"),
);
if (parseErrors.length > 0) {
  for (const error of parseErrors) {
    console.error(`✖ ${error}`);
  }
  process.exit(1);
}

/** @type {import("./workspace-rules.mjs").WorkspaceManifest[]} */
const manifests = [];

for (const root of workspaceRoots) {
  const rootDir = join(repoRoot, root);
  if (!existsSync(rootDir)) continue;
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(rootDir, entry.name, "package.json");
    if (!existsSync(pkgPath)) continue; // package.json のない空ディレクトリは workspace ではない

    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch (error) {
      console.error(`✖ ${root}/${entry.name}/package.json の JSON 解析に失敗: ${String(error)}`);
      process.exit(1);
    }
    if (parsed === null || typeof parsed !== "object") {
      console.error(`✖ ${root}/${entry.name}/package.json がオブジェクトではない`);
      process.exit(1);
    }
    const pkg = /** @type {Record<string, unknown>} */ (parsed);
    if (typeof pkg.name !== "string" || pkg.name === "") {
      console.error(`✖ ${root}/${entry.name}/package.json に name がない`);
      process.exit(1);
    }
    manifests.push({
      name: pkg.name,
      dir: `${root}/${entry.name}`,
      deps: mergeDependencies(pkg),
    });
  }
}

const violations = collectWorkspaceViolations(manifests);

if (violations.length > 0) {
  console.error("✖ 依存方向ルール違反を検出しました:");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log(`✓ 依存方向ルール OK（検査対象 ${manifests.length} workspace）`);
