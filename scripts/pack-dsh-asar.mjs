#!/usr/bin/env node
/**
 * Pack dsh-runtime into build/dsh.asar (+ dsh.asar.unpacked for natives).
 * Shipped via electron-builder extraResources so we avoid app FileSet
 * excluding the FileSet-root node_modules directory.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import asar from "@electron/asar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "dsh-runtime");
const outDir = path.join(root, "build");
const dest = path.join(outDir, "dsh.asar");
const destUnpacked = path.join(outDir, "dsh.asar.unpacked");

if (!fs.existsSync(path.join(src, "node_modules", "@deepseek-ai", "dsh-sdk-client", "package.json"))) {
  console.error("dsh-runtime not prepared — run scripts/prepare-dsh.mjs first");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(dest, { force: true });
fs.rmSync(destUnpacked, { recursive: true, force: true });

const unpack =
  "{**/*.{node,dll,exe,dylib,so},**/prebuilds/**,**/sharp-*/**,**/libvips*,**/conpty/**,@img/**,@koromix/**,sherpa-onnx-*/**,@vscode/ripgrep-*/**,@deepseek-ai/libreoffice-kit-*/**}";

console.log("packing dsh-runtime → build/dsh.asar …");
await asar.createPackageWithOptions(src, dest, { unpack });

const asarSize = fs.statSync(dest).size;
let unpackedSize = 0;
if (fs.existsSync(destUnpacked)) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else unpackedSize += fs.statSync(p).size;
    }
  };
  walk(destUnpacked);
}

// Sanity: sdk-client must be inside the asar (or unpacked)
const list = asar.listPackage(dest);
const hasSdk = list.some((f) => f.replace(/\\/g, "/").includes("node_modules/@deepseek-ai/dsh-sdk-client/package.json"));
const hasDsh = list.some((f) => f.replace(/\\/g, "/").includes("node_modules/@deepseek-ai/dsh/package.json"));
if (!hasSdk || !hasDsh) {
  console.error("asar missing @deepseek-ai/dsh or dsh-sdk-client", { hasSdk, hasDsh, sample: list.slice(0, 20) });
  process.exit(1);
}

// Stage for electron-builder extraResources (avoids FileSet root node_modules filter)
const packDir = path.join(outDir, "dsh-pack");
fs.rmSync(packDir, { recursive: true, force: true });
fs.mkdirSync(packDir, { recursive: true });
fs.renameSync(dest, path.join(packDir, "dsh.asar"));
if (fs.existsSync(destUnpacked)) {
  fs.renameSync(destUnpacked, path.join(packDir, "dsh.asar.unpacked"));
}
// Keep stable paths build/dsh.asar for convenience
fs.linkSync(path.join(packDir, "dsh.asar"), dest);
if (fs.existsSync(path.join(packDir, "dsh.asar.unpacked"))) {
  // hardlink tree not practical; leave only under dsh-pack + recreate symlink
  try { fs.symlinkSync(path.join(packDir, "dsh.asar.unpacked"), destUnpacked, "dir"); } catch { /* ok */ }
}

console.log(
  `dsh.asar ready: ${(asarSize / 1048576).toFixed(1)} MB asar` +
    (unpackedSize ? ` + ${(unpackedSize / 1048576).toFixed(1)} MB unpacked` : "") +
    ` (${list.length} entries) → build/dsh-pack/`,
);
