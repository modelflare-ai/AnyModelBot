import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeDshRuntime } from "../src/agent/host.js";
import { findAppRoot } from "../src/magpie/supervisor.js";

const packagedAsar = path.join(findAppRoot(), "release", "win-unpacked", "resources", "dsh.asar");
const hasPackaged = fs.existsSync(packagedAsar) && fs.existsSync(`${packagedAsar}.unpacked`);

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("materializeDshRuntime", () => {
  it("returns plain dirs unchanged", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-plain-"));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, "node_modules", "@deepseek-ai", "dsh-sdk-client"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "@deepseek-ai", "dsh-sdk-client", "package.json"), "{}");
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "amb-cache-"));
    dirs.push(cache);
    expect(materializeDshRuntime(dir, cache)).toBe(dir);
  });

  it.skipIf(!hasPackaged)("extracts packaged dsh.asar + unpacked natives into versioned cache", () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "amb-dsh-mat-"));
    dirs.push(cache);
    const dest = materializeDshRuntime(packagedAsar, cache);
    expect(dest).toContain(path.join(cache, "dsh-runtime"));
    expect(fs.existsSync(path.join(dest, ".amb-dsh-ready"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "node_modules", "@deepseek-ai", "dsh-sdk-client", "package.json"))).toBe(true);
    // At least one native from dsh.asar.unpacked
    const walk = (d: string): string[] => {
      const out: string[] = [];
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) out.push(...walk(p));
        else if (e.name.endsWith(".node")) out.push(p);
      }
      return out;
    };
    expect(walk(dest).length).toBeGreaterThan(0);
    // Second call hits cache marker
    expect(materializeDshRuntime(packagedAsar, cache)).toBe(dest);
  });
});
