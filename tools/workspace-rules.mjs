// workspace 間の依存方向ルール（basic-design 2.2 — 決定 D7）の検証ロジック。
// 依存グラフは workspace ごとの許可隣接リストで固定する:
//   - packages/shared  → 依存なし（他 workspace に依存しない）
//   - packages/*       → packages/shared のみ（packages 同士の横依存禁止）
//   - apps/web         → packages/shared のみ（apps/api とは HTTP でのみ通信）
//   - apps/api         → packages/* すべて
//   - 上記以外の workspace → fail-closed（workspace 依存を一切許可しない。
//     新しい workspace を増やす場合は基本設計の依存グラフを更新のうえ、ここへ隣接リストを追加する）
// 純粋関数として実装し、CLI（check-workspace-deps.mjs）とテストの両方から使う。

export const SHARED_DIR = "packages/shared";

/**
 * @typedef {object} WorkspaceManifest
 * @property {string} name package.json の name
 * @property {string} dir リポジトリルートからの相対パス（例: "packages/shared"）
 * @property {Record<string, string>} deps dependencies/devDependencies 等を統合したもの
 */

/**
 * dir の workspace が targetDir の workspace に依存してよいか（許可隣接リスト）。
 * @param {string} dir
 * @param {string} targetDir
 * @returns {boolean}
 */
export function isAllowedDependency(dir, targetDir) {
  if (dir === SHARED_DIR) return false;
  if (dir.startsWith("packages/")) return targetDir === SHARED_DIR;
  if (dir === "apps/web") return targetDir === SHARED_DIR;
  if (dir === "apps/api") return targetDir.startsWith("packages/");
  // 未定義の workspace は fail-closed（隣接リストへの明示追加を要求する）
  return false;
}

/**
 * 依存値がローカル参照（workspace 依存相当）とみなせるか。
 * workspace: に加え、link: / file: による別名 link 依存の素通りも検証対象に含める。
 * @param {string} version
 * @returns {boolean}
 */
export function isLocalDependencyVersion(version) {
  return (
    version.startsWith("workspace:") || version.startsWith("link:") || version.startsWith("file:")
  );
}

/**
 * 依存方向ルール違反の一覧を返す（違反なしなら空配列）。
 * @param {WorkspaceManifest[]} manifests
 * @returns {string[]} violation メッセージの配列
 */
export function collectWorkspaceViolations(manifests) {
  const violations = [];
  const byName = new Map(manifests.map((m) => [m.name, m]));

  for (const manifest of manifests) {
    if (!manifest.dir.startsWith("apps/") && !manifest.dir.startsWith("packages/")) {
      violations.push(
        `${manifest.dir}: workspace は apps/ または packages/ 配下に置くこと（想定外の配置）`,
      );
      continue;
    }

    for (const [depName, depVersion] of Object.entries(manifest.deps)) {
      const target = byName.get(depName);
      const isWorkspaceDep = target !== undefined || isLocalDependencyVersion(depVersion);

      if (!isWorkspaceDep) continue;

      if (target === undefined) {
        violations.push(
          `${manifest.dir}: ローカル参照依存 "${depName}" (${depVersion}) に対応する workspace が見つからない`,
        );
        continue;
      }

      if (!isAllowedDependency(manifest.dir, target.dir)) {
        violations.push(
          `${manifest.dir}: ${target.dir} への依存は禁止（許可される依存先 — packages/shared: なし / packages/*: shared のみ / apps/web: shared のみ / apps/api: packages/* のみ）`,
        );
      }
    }
  }

  return violations;
}

/**
 * package.json のオブジェクトから検証対象の依存を統合して取り出す。
 * @param {{ name?: unknown, dependencies?: unknown, devDependencies?: unknown, peerDependencies?: unknown, optionalDependencies?: unknown }} pkg
 * @returns {Record<string, string>}
 */
export function mergeDependencies(pkg) {
  /** @type {Record<string, string>} */
  const merged = {};
  for (const key of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const section = pkg[key];
    if (section === null || typeof section !== "object") continue;
    for (const [name, version] of Object.entries(section)) {
      if (typeof version === "string") merged[name] = version;
    }
  }
  return merged;
}

/**
 * pnpm-workspace.yaml の packages: から workspace ルートディレクトリを導出する。
 * サポートするのは "dir/*" 形式のグロブのみ（それ以外のパターンはエラーとして報告）。
 * @param {string} yamlText
 * @returns {{ roots: string[], errors: string[] }}
 */
export function parseWorkspaceRoots(yamlText) {
  /** @type {string[]} */
  const roots = [];
  /** @type {string[]} */
  const errors = [];
  let inPackages = false;

  for (const rawLine of yamlText.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (line.trim() === "") continue;
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = line.match(/^\s+-\s*["']?([^"']+?)["']?\s*$/);
    if (!item) {
      // packages: のリストを抜けた（別のトップレベルキーに入った）
      inPackages = false;
      continue;
    }
    const glob = item[1];
    const root = glob.replace(/\/\*+$/, "");
    if (root === "" || root.includes("*") || root.startsWith("!")) {
      errors.push(`pnpm-workspace.yaml のパターン "${glob}" は未対応（"dir/*" 形式のみ）`);
      continue;
    }
    roots.push(root);
  }

  if (roots.length === 0 && errors.length === 0) {
    errors.push("pnpm-workspace.yaml から workspace ルートを導出できなかった");
  }
  return { roots, errors };
}
