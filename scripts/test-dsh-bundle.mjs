#!/usr/bin/env node
// Run the real-DSH integration test (test/agent.integration.test.ts) against the packaged layout from
// scripts/bundle-dsh.mjs instead of dsh-runtime/: Electron in Node mode (as in the app) runs the test, and the
// agent host loads the SDK client and starts DSH from dsh.asar + the native node_modules next to it.
//   node scripts/test-dsh-bundle.mjs [bundle dir, default build/dsh]
// The bundle is copied out of the checkout first (vitest rewrites import() of files under the project root to
// root-relative ids, which do not exist on disk), and not into /tmp: the Linux sandbox hides /tmp from tool
// subprocesses, and the PTC runtime runs Electron on files inside dsh.asar.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.resolve(root, process.argv[2] ?? path.join("build", "dsh"));
if (!fs.existsSync(path.join(bundle, "dsh.asar"))) {
  console.error(`test-dsh-bundle: ${bundle}/dsh.asar not found; run scripts/bundle-dsh.mjs first`);
  process.exit(1);
}
const base = path.join(os.homedir(), ".cache");
fs.mkdirSync(base, { recursive: true });
const tmp = fs.mkdtempSync(path.join(base, "amb-dsh-bundle-"));
const copy = path.join(tmp, "dsh");
let status = 1;
try {
  fs.cpSync(bundle, copy, { recursive: true });
  const electron = createRequire(import.meta.url)("electron");
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", AMB_DSH_RUNTIME: path.join(copy, "dsh.asar") };
  const probe = spawnSync(electron, ["-e", "process.exit(require('fs').existsSync(process.env.AMB_DSH_RUNTIME + '/node_modules/@deepseek-ai/dsh-sdk-client/package.json') ? 0 : 1)"], { env });
  if (probe.status !== 0) throw new Error(`Electron cannot read ${env.AMB_DSH_RUNTIME}`);
  const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
  const r = spawnSync(electron, [vitest, "run", "test/agent.integration.test.ts", ...process.argv.slice(3)], { cwd: root, env, stdio: "inherit" });
  status = r.status ?? 1;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(status);
