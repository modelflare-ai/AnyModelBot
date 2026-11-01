import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error 没有类型声明的脚本
import { changelogSection } from "../scripts/release-notes.mjs";

const SAMPLE = "# 更新日志\n\n## 1.2.0 - 2026-11-02\n\n### 新增\n\n- 甲\n\n## 1.1.0 - 2026-10-01\n\n- 乙\n\n## 1.0.0\n";
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version as string;

describe("更新日志", () => {
  it("只取这个版本的那一段；没有或是空的回 undefined；不会把 1.2.0 认成 1.2.01", () => {
    expect(changelogSection(SAMPLE, "1.2.0")).toBe("### 新增\n\n- 甲");
    expect(changelogSection(SAMPLE, "1.1.0")).toBe("- 乙");
    expect(changelogSection(SAMPLE, "1.0.0")).toBeUndefined();
    expect(changelogSection(SAMPLE, "1.2")).toBeUndefined();
    expect(changelogSection(SAMPLE, "9.9.9")).toBeUndefined();
  });

  it("当前版本中英文都写了；发布说明中文在前", () => {
    const notes = execFileSync(process.execPath, ["scripts/release-notes.mjs", version], { encoding: "utf8" });
    expect(notes).toContain("### 新增");
    expect(notes.indexOf("### 新增")).toBeLessThan(notes.indexOf("### New"));
  });

  it("这个版本没写更新日志：脚本失败，发布流程开始就停下", () => {
    const r = spawnSync(process.execPath, ["scripts/release-notes.mjs", "9.9.9"], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no entry for 9.9.9");
  });

  it("发布流程用更新日志做说明，不再用自动生成的 PR 列表", () => {
    const yml = fs.readFileSync(".github/workflows/release.yml", "utf8");
    expect(yml).not.toContain("--generate-notes");
    expect(yml).toContain("--notes-file");
    expect(yml).toContain("This version has a changelog entry");
  });
});
