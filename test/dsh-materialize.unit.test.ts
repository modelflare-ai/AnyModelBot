import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { locateDshRuntime, materializeDshRuntime } from "../src/agent/host.js";
import { findAppRoot } from "../src/magpie/supervisor.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("materializeDshRuntime", () => {
  it("is identity (no extract) for plain dirs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-plain-"));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, "node_modules", "@deepseek-ai", "dsh-sdk-client"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "@deepseek-ai", "dsh-sdk-client", "package.json"), "{}");
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "amb-cache-"));
    dirs.push(cache);
    expect(materializeDshRuntime(dir, cache)).toBe(dir);
    expect(fs.readdirSync(cache)).toEqual([]);
  });

  it("does not extract even when path looks like an asar", () => {
    const fake = path.join(os.tmpdir(), "amb-fake-dsh.asar");
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "amb-cache-asar-"));
    dirs.push(cache);
    expect(materializeDshRuntime(fake, cache)).toBe(fake);
    expect(fs.readdirSync(cache)).toEqual([]);
  });
});

describe("locateDshRuntime", () => {
  it("finds checkout dsh-runtime when prepared", () => {
    const root = findAppRoot();
    const hit = locateDshRuntime(root);
    // In CI/dev after prepare-dsh; skip soft if missing
    if (!hit) return;
    expect(hit).toContain("dsh");
    expect(fs.existsSync(path.join(hit, "node_modules", "@deepseek-ai", "dsh-sdk-client", "package.json"))).toBe(true);
  });
});
