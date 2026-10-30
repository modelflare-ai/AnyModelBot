#!/usr/bin/env node
/**
 * Bundle the prepared DSH runtime (dsh-runtime/, see prepare-dsh.mjs) into build/dsh/ for packaging:
 *
 *   build/dsh/dsh.asar        package.json, plugins/ and every package of node_modules that is plain
 *                             JavaScript/data: ~11k files in ONE archive
 *   build/dsh/node_modules/   only the packages that carry native code (.node addons, shared libraries,
 *                             executables such as ripgrep, node-pty's spawn-helper, landlock-run)
 *
 * The packaged app points the agent host at resources/dsh/dsh.asar. Electron reads asar archives in the
 * main process and in ELECTRON_RUN_AS_NODE children (the DSH host and every Node subprocess it starts:
 * subprocess runner, PTC, MCP servers), including ESM imports, worker threads and fs reads. Paths inside
 * the archive are unchanged, so DSH's own package-name resolution (manifest graph walk, interception of
 * Node's resolver, import.meta.url anchors) works as on a plain node_modules tree.
 *
 * Native packages cannot live in the archive (the OS loader and child_process need real files), so they
 * are copied next to it. Node's lookup from build/dsh/dsh.asar/node_modules/<pkg>/... continues to the
 * parent build/dsh/node_modules, so `require("@img/sharp-win32-x64/...")`, koffi, node-pty, ripgrep and
 * the landlock launcher resolve to real paths there, exactly as in a normal install.
 *
 * Why not one esbuild bundle: DSH loads ~100 plugins by package name through a graph walk over every
 * package.json, hooks Node's internal ESM resolver, and anchors assets and workers on import.meta.url.
 * An archive keeps all of that intact; a JS bundle would have to rewrite DSH internals.
 *
 * File count is what makes the Windows installer slow (NSIS extraction + Defender scanning each file):
 * ~12.5k files in resources/dsh before, a few dozen after.
 *
 *   node scripts/bundle-dsh.mjs                       # target = this machine
 *   node scripts/bundle-dsh.mjs --os win32 --cpu x64  # must match the last prepare-dsh run
 *   options: --src <prepared runtime dir> (default dsh-runtime)  --out <dir> (default build/dsh)
 */
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import asar from "@electron/asar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const os = arg("os", process.platform);
const cpu = arg("cpu", process.arch);
const src = path.resolve(root, arg("src", "dsh-runtime"));
const out = path.resolve(root, arg("out", path.join("build", "dsh")));
const nm = path.join(src, "node_modules");
const fail = (msg) => {
  console.error(`bundle-dsh: ${msg}`);
  process.exit(1);
};

/**
 * Packages left out of the packaged runtime: big, and unreachable from what the app runs (the "sdk" profile
 * over stdio plus the plugins in host.ts). Each entry is checked below: no shipped file may import one.
 */
const DROP = [
  // Office engines (LibreOffice natives: 735 files / 182 MB on win32-x64; WASM: 145 MB on Linux). The sdk
  // profile disables dsh-skill-office unless DSH_PRIMARY_RUNTIME / DSH_BUNDLED_OFFICE_* are set, which the
  // app never does; office-to-pdf belongs to the web document preview.
  /^@deepseek-ai\/libreoffice-kit-/,
  // Speech-to-text natives, only for the optional voice-input bundle of the web UI.
  /^sherpa-onnx-/,
  // DSH web UI: browser bundles served by the web profile's frontend host, and the devtools inspector.
  /^@deepseek-ai\/dsh-client-ui-/,
  /^@deepseek-ai\/dsh-experimental-client-ui-/,
  /^@deepseek-ai\/dsh-web-frontend$/,
  /^@deepseek-ai\/dsh-experimental-inspector$/,
  // Electron on Linux is glibc-only; npm installs the musl builds too because --os/--cpu ignore libc.
  ...(os === "linux" ? [/musl/] : []),
];
/** References to dropped packages that exist in shipped files but are never reached in the host process. */
const ALLOWED_REFS = [
  // sharp probes every platform/libc build in try/catch
  [/^node_modules\/sharp\//, /^@img\/sharp-/],
  // browser halves of DSH packages ("./client" exports and their unbundled sources) import UI packages
  [/^node_modules\/@deepseek-ai\/[^/]+\/lib\/(client[^/]*\.js$|types\/client\/)/, /^@deepseek-ai\/dsh-(experimental-)?client-ui-|^@deepseek-ai\/dsh-web-frontend/],
];

// Build-time leftovers inside native packages (C/C++ sources, gyp/CMake files, debug symbols, import libs).
const NATIVE_JUNK = /\.(c|cc|cpp|cxx|h|hh|hpp|inc|S|asm|gyp|gypi|pdb|lib|exp|ilk|md|markdown)$|^CMakeLists\.txt$/i;

const MAGIC = [
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O 64
  [0xce, 0xfa, 0xed, 0xfe], // Mach-O 32
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xfe, 0xed, 0xfa, 0xce],
  [0xca, 0xfe, 0xba, 0xbe], // universal Mach-O
  [0x4d, 0x5a], // PE (MZ)
];
const isNativeFile = (file, name) => {
  if (/\.(node|dll|exe|dylib|so(\.\d+)*)$/i.test(name)) return true;
  const buf = Buffer.alloc(4);
  const fd = fs.openSync(file, "r");
  const n = fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);
  return MAGIC.some((m) => m.length <= n && m.every((b, i) => buf[i] === b));
};

// ---------- sanity: dsh-runtime must be prepared, and for this target ----------
if (!fs.existsSync(path.join(nm, "@deepseek-ai", "dsh-sdk-client", "package.json"))) fail(`${src} is not prepared; run scripts/prepare-dsh.mjs first`);
const prebuilds = path.join(nm, "node-pty", "prebuilds");
const have = fs.existsSync(prebuilds) ? fs.readdirSync(prebuilds).sort().join(",") : "";
if (have !== `${os}-${cpu}`) fail(`dsh-runtime holds node-pty prebuilds [${have}], expected [${os}-${cpu}]; run scripts/prepare-dsh.mjs --os ${os} --cpu ${cpu} first`);

// ---------- packages ----------
/** @type {Array<{ name: string, rel: string, dir: string, deps: string[], files: string[], native: boolean }>} */
const pkgs = [];
function collect(modulesDir) {
  for (const e of fs.readdirSync(modulesDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const names = e.name.startsWith("@") ? fs.readdirSync(path.join(modulesDir, e.name)).map((s) => `${e.name}/${s}`) : [e.name];
    for (const name of names) {
      const dir = path.join(modulesDir, name);
      if (!fs.existsSync(path.join(dir, "package.json"))) continue;
      const pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      const files = [];
      let native = false;
      (function walk(d) {
        for (const f of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, f.name);
          if (f.isDirectory()) {
            if (d === dir && f.name === "node_modules") collect(p);
            else walk(p);
          } else if (f.isFile()) {
            files.push(p);
            if (!native && isNativeFile(p, f.name)) native = true;
          } else if (!(d === dir && f.name === "node_modules")) fail(`unexpected non-file ${p}`);
        }
      })(dir);
      pkgs.push({ name, rel: path.relative(src, dir), dir, deps: Object.keys({ ...pj.dependencies, ...pj.optionalDependencies }), files, native });
    }
  }
}
collect(nm);

const dropped = new Set(pkgs.filter((p) => DROP.some((re) => re.test(p.name))).map((p) => p.rel));
const kept = pkgs.filter((p) => !dropped.has(p.rel));

// Platform packages must all be for this target (npm < 10 ignores --os/--cpu and installs the host's).
const PLATFORM_PKG = /(?:^|[-/])(linuxmusl|linux|darwin|win32|win|freebsd|openbsd|android)-(x64|arm64|ia32|arm|riscv64|loong64|ppc64|s390x)(?:-|$)/;
const foreign = kept.filter((p) => {
  const m = PLATFORM_PKG.exec(p.name);
  if (!m) return false;
  const pkgOs = { linuxmusl: "linux", win: "win32" }[m[1]] ?? m[1];
  return pkgOs !== os || m[2] !== cpu;
});
if (foreign.length) fail(`dsh-runtime holds native packages for another platform than ${os}-${cpu}: ${foreign.map((p) => p.name).join(", ")} (prepare-dsh needs npm >= 10 to honour --os/--cpu)`);
const byRel = new Map(kept.map((p) => [p.rel, p]));

/** Node's lookup of `dep` from package `p`: nearest node_modules first (inside src only). */
function resolveDep(p, dep) {
  let base = p.rel;
  for (;;) {
    const hit = byRel.get(path.join(base, "node_modules", dep));
    if (hit) return hit;
    const i = base.lastIndexOf(`node_modules${path.sep}`);
    if (i < 0) return undefined;
    base = base.slice(0, i).replace(/[\\/]$/, "");
  }
}
// A package goes outside the archive if it has native code, plus (transitively) whatever it depends on:
// from build/dsh/node_modules, Node never looks back into the archive. A nested native package takes its
// top-level ancestor along, so that ancestor still finds it in its own node_modules.
const outside = new Set();
const topLevel = (rel) => {
  const parts = rel.split(path.sep);
  return parts.slice(0, parts[1].startsWith("@") ? 3 : 2).join(path.sep);
};
const queue = kept.filter((p) => p.native);
while (queue.length) {
  const p = queue.shift();
  const top = topLevel(p.rel);
  for (const q of kept.filter((k) => k.rel === top || k.rel.startsWith(top + path.sep))) {
    if (outside.has(q.rel)) continue;
    outside.add(q.rel);
    for (const d of q.deps) {
      const r = resolveDep(q, d);
      if (r && !outside.has(r.rel)) queue.push(r);
    }
  }
}

// ---------- guard: no shipped file may import a dropped package ----------
const droppedNames = new Set(pkgs.filter((p) => dropped.has(p.rel)).map((p) => p.name));
const keptNames = new Set(kept.map((p) => p.name));
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"'./][^"']*)["']/g;
const refs = [];
for (const p of kept) {
  for (const f of p.files) {
    if (!/\.(c|m)?js$/.test(f)) continue;
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(SPEC)) {
      const spec = m[1];
      if (spec.startsWith("node:") || builtinModules.includes(spec)) continue;
      const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      const from = path.relative(src, f).replaceAll("\\", "/");
      if (!droppedNames.has(name) || keptNames.has(name)) continue;
      if (!ALLOWED_REFS.some(([file, target]) => file.test(from) && target.test(spec))) refs.push(`${from} -> ${spec}`);
    }
  }
}
if (refs.length) fail(`shipped files import dropped packages (shrink DROP or prove these paths unreachable):\n  ${[...new Set(refs)].join("\n  ")}`);

// ---------- write build/dsh ----------
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const inArchive = [path.join(src, "package.json")];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.isFile()) inArchive.push(p);
  }
})(path.join(src, "plugins"));
let outsideFiles = 0;
let outsideBytes = 0;
for (const p of kept) {
  if (!outside.has(p.rel)) {
    inArchive.push(...p.files);
    continue;
  }
  for (const f of p.files) {
    if (NATIVE_JUNK.test(path.basename(f)) && !/^licen[cs]e/i.test(path.basename(f))) continue;
    const dest = path.join(out, path.relative(src, f));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f, dest);
    fs.chmodSync(dest, fs.statSync(f).mode & 0o777);
    outsideFiles++;
    outsideBytes += fs.statSync(f).size;
  }
}
const archive = path.join(out, "dsh.asar");
await asar.createPackageFromFiles(src, archive, inArchive.sort());
if (fs.existsSync(`${archive}.unpacked`)) fail("unexpected dsh.asar.unpacked");

// ---------- verify ----------
const listed = new Set(asar.listPackage(archive, { isPack: false }).map((f) => f.replaceAll("\\", "/")));
for (const f of ["/package.json", "/plugins/amb-bridge.mjs", "/node_modules/@deepseek-ai/dsh/package.json", "/node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js"]) {
  if (!listed.has(f)) fail(`dsh.asar is missing ${f}`);
}
if (!fs.existsSync(path.join(out, "node_modules", "node-pty", "prebuilds", `${os}-${cpu}`))) fail("node-pty prebuilds were not copied next to dsh.asar");

const mb = (n) => (n / 1048576).toFixed(1);
const count = (list) => list.reduce((n, p) => n + p.files.length, 0);
const nonPackage = inArchive.length - count(kept.filter((p) => !outside.has(p.rel))); // package.json + plugins
console.log(
  [
    `dsh bundled for ${os}-${cpu} → ${path.relative(root, out)}`,
    `  dsh.asar: ${inArchive.length} files, ${mb(fs.statSync(archive).size)} MB`,
    `  node_modules (native, real files): ${outside.size} packages, ${outsideFiles} files, ${mb(outsideBytes)} MB: ${[...outside].map((r) => r.replace(/^node_modules[\\/]/, "")).sort().join(", ")}`,
    `  dropped: ${dropped.size} packages, ${count(pkgs.filter((p) => dropped.has(p.rel)))} files`,
    `  resources/dsh: ${outsideFiles + 1} files (unbundled: ${count(pkgs) + nonPackage})`,
  ].join("\n"),
);
