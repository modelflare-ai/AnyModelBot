import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkStatic } from "../src/botkit/check.js";
import { validate } from "../src/botkit/schema.js";

const root = path.join(import.meta.dirname, "..");
const bot = path.join(root, "bots", "printfilm");
const python = ["python3", "python"].find((p) => spawnSync(p, ["--version"]).status === 0);

describe("PRINTFILM", () => {
  it("packages all five locales, valid samples and upstream attribution", () => {
    expect(checkStatic(bot).issues).toEqual([]);
    const schema = JSON.parse(fs.readFileSync(path.join(bot, "state.schema.json"), "utf8"));
    for (const lang of ["zh-CN", "zh-TW", "en", "ja", "ko", "ru", "es", "pt", "tr"]) {
      const sample = JSON.parse(fs.readFileSync(path.join(bot, `sample.${lang}.json`), "utf8"));
      expect(validate(sample, schema)).toEqual([]);
      for (const s of sample.sampleEpisode.shots) expect(fs.existsSync(path.join(bot, "ui", s.media.image[0].path))).toBe(true);
    }
    expect(fs.readFileSync(path.join(bot, "skills/printfilm/LICENSE"), "utf8")).toContain("Copyright (c) 2026 PRINTFILM");
  });
  it.skipIf(!python)("runs real persistence, recovery, graph and FFmpeg workflow tests", () => {
    const result = spawnSync(python!, [path.join(root, "test/printfilm_runtime_test.py")], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, timeout: 120_000 });
    expect(result.stdout + result.stderr, "runtime tests").toContain("OK");
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 130_000);
});
