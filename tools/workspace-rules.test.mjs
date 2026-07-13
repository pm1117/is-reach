// 依存方向ルール（basic-design 2.2）検証ロジックのテスト。
import { describe, expect, it } from "vitest";
import {
  collectWorkspaceViolations,
  isLocalDependencyVersion,
  mergeDependencies,
  parseWorkspaceRoots,
} from "./workspace-rules.mjs";

/** @param {string} dir @param {string} name @param {Record<string, string>} [deps] */
const ws = (dir, name, deps = {}) => ({ dir, name, deps });

describe("collectWorkspaceViolations", () => {
  it("正しい依存方向（web → shared のみ / api → packages/* / packages → shared のみ）は違反なし", () => {
    const manifests = [
      ws("packages/shared", "@is-reach/shared", { zod: "^4.0.0" }),
      ws("packages/crawler", "@is-reach/crawler", { "@is-reach/shared": "workspace:*" }),
      ws("packages/analysis", "@is-reach/analysis", { "@is-reach/shared": "workspace:*" }),
      ws("packages/prompt", "@is-reach/prompt", { "@is-reach/shared": "workspace:*" }),
      ws("apps/api", "@is-reach/api", {
        "@is-reach/shared": "workspace:*",
        "@is-reach/crawler": "workspace:*",
        "@is-reach/analysis": "workspace:*",
        "@is-reach/prompt": "workspace:*",
      }),
      ws("apps/web", "@is-reach/web", { "@is-reach/shared": "workspace:*" }),
    ];
    expect(collectWorkspaceViolations(manifests)).toEqual([]);
  });

  it("shared が他 workspace に依存すると違反", () => {
    const manifests = [
      ws("packages/shared", "@is-reach/shared", { "@is-reach/crawler": "workspace:*" }),
      ws("packages/crawler", "@is-reach/crawler"),
    ];
    const violations = collectWorkspaceViolations(manifests);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("packages/shared");
  });

  it("packages 同士の横依存（crawler → prompt）は違反", () => {
    const manifests = [
      ws("packages/shared", "@is-reach/shared"),
      ws("packages/crawler", "@is-reach/crawler", { "@is-reach/prompt": "workspace:*" }),
      ws("packages/prompt", "@is-reach/prompt", { "@is-reach/shared": "workspace:*" }),
    ];
    const violations = collectWorkspaceViolations(manifests);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("packages/crawler");
    expect(violations[0]).toContain("packages/prompt");
  });

  it("packages → apps の逆流は違反", () => {
    const manifests = [
      ws("packages/shared", "@is-reach/shared"),
      ws("packages/analysis", "@is-reach/analysis", { "@is-reach/api": "workspace:*" }),
      ws("apps/api", "@is-reach/api"),
    ];
    const violations = collectWorkspaceViolations(manifests);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("packages/analysis");
  });

  it("apps 同士の依存（web → api）は違反", () => {
    const manifests = [
      ws("apps/web", "@is-reach/web", { "@is-reach/api": "workspace:*" }),
      ws("apps/api", "@is-reach/api"),
    ];
    const violations = collectWorkspaceViolations(manifests);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("apps/web");
  });

  it("apps/web → packages/prompt は違反（web の依存先は shared のみ — basic-design 2.2 の依存グラフ）", () => {
    const manifests = [
      ws("packages/shared", "@is-reach/shared"),
      ws("packages/prompt", "@is-reach/prompt", { "@is-reach/shared": "workspace:*" }),
      ws("apps/web", "@is-reach/web", {
        "@is-reach/shared": "workspace:*",
        "@is-reach/prompt": "workspace:*",
      }),
    ];
    const violations = collectWorkspaceViolations(manifests);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("apps/web");
    expect(violations[0]).toContain("packages/prompt");
  });

  it("隣接リスト未定義の workspace（apps/admin 等）の workspace 依存は fail-closed で違反", () => {
    const manifests = [
      ws("packages/shared", "@is-reach/shared"),
      ws("apps/admin", "@is-reach/admin", { "@is-reach/shared": "workspace:*" }),
    ];
    expect(collectWorkspaceViolations(manifests)).toHaveLength(1);
  });

  it("link: / file: による別名 link 依存も検証対象になる", () => {
    const manifests = [
      ws("packages/shared", "@is-reach/shared"),
      ws("packages/crawler", "@is-reach/crawler", { "@is-reach/prompt": "link:../prompt" }),
      ws("packages/prompt", "@is-reach/prompt"),
      ws("packages/analysis", "@is-reach/analysis", { "some-local-lib": "file:../../vendor/lib" }),
    ];
    const violations = collectWorkspaceViolations(manifests);
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain("packages/crawler");
    expect(violations[1]).toContain("some-local-lib");
  });

  it("devDependencies 経由の横依存も検出する", () => {
    const manifests = [
      ws("packages/shared", "@is-reach/shared"),
      {
        dir: "packages/crawler",
        name: "@is-reach/crawler",
        deps: mergeDependencies({ devDependencies: { "@is-reach/analysis": "workspace:*" } }),
      },
      ws("packages/analysis", "@is-reach/analysis"),
    ];
    expect(collectWorkspaceViolations(manifests)).toHaveLength(1);
  });

  it("名前解決できない workspace: 依存は違反として報告する", () => {
    const manifests = [
      ws("packages/shared", "@is-reach/shared"),
      ws("packages/crawler", "@is-reach/crawler", { "@is-reach/unknown": "workspace:*" }),
    ];
    const violations = collectWorkspaceViolations(manifests);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("@is-reach/unknown");
  });

  it("apps/ packages/ 以外の配置は違反", () => {
    const manifests = [ws("libs/util", "@is-reach/util")];
    expect(collectWorkspaceViolations(manifests)).toHaveLength(1);
  });

  it("npm レジストリの外部依存は違反にならない", () => {
    const manifests = [
      ws("packages/shared", "@is-reach/shared", { zod: "^4.0.0" }),
      ws("packages/crawler", "@is-reach/crawler", { undici: "^7.0.0" }),
    ];
    expect(collectWorkspaceViolations(manifests)).toEqual([]);
  });
});

describe("isLocalDependencyVersion", () => {
  it("workspace: / link: / file: をローカル参照とみなす", () => {
    expect(isLocalDependencyVersion("workspace:*")).toBe(true);
    expect(isLocalDependencyVersion("link:../prompt")).toBe(true);
    expect(isLocalDependencyVersion("file:../prompt")).toBe(true);
    expect(isLocalDependencyVersion("^4.0.0")).toBe(false);
    expect(isLocalDependencyVersion("npm:zod@^4.0.0")).toBe(false);
  });
});

describe("mergeDependencies", () => {
  it("4 種類の依存セクションを統合する", () => {
    expect(
      mergeDependencies({
        dependencies: { a: "1" },
        devDependencies: { b: "2" },
        peerDependencies: { c: "3" },
        optionalDependencies: { d: "4" },
      }),
    ).toEqual({ a: "1", b: "2", c: "3", d: "4" });
  });

  it("セクションがオブジェクトでない場合は無視する", () => {
    expect(mergeDependencies({ dependencies: null, devDependencies: undefined })).toEqual({});
  });
});

describe("parseWorkspaceRoots", () => {
  it("packages: のグロブから workspace ルートを導出する", () => {
    const yaml = ["packages:", '  - "apps/*"', '  - "packages/*"', ""].join("\n");
    expect(parseWorkspaceRoots(yaml)).toEqual({ roots: ["apps", "packages"], errors: [] });
  });

  it("引用符なし・コメント付きでも導出できる", () => {
    const yaml = ["# workspaces", "packages:", "  - apps/* # アプリ", "  - packages/*"].join("\n");
    expect(parseWorkspaceRoots(yaml).roots).toEqual(["apps", "packages"]);
  });

  it("未対応パターン（ネストグロブ・否定）はエラーとして報告する", () => {
    const yaml = ["packages:", '  - "libs/**/utils"', '  - "!excluded/*"'].join("\n");
    const { roots, errors } = parseWorkspaceRoots(yaml);
    expect(roots).toEqual([]);
    expect(errors).toHaveLength(2);
  });

  it("packages: が空なら導出失敗をエラーとして報告する", () => {
    const { errors } = parseWorkspaceRoots("other:\n  - x\n");
    expect(errors).toHaveLength(1);
  });
});
