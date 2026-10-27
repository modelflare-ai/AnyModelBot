#!/usr/bin/env node
/**
 * Deprecated (0.1.3+): DSH ships as a pruned real directory via extraResources
 * (`dsh-runtime` → `resources/dsh`), not as dsh.asar.
 * Giant asar caused Windows Defender thrashing; first-launch extract made startup slow.
 * Follow-up: esbuild-bundle DSH JS into few files + native externals (Claude/Gemini pattern).
 */
console.log("pack-dsh-asar: no-op since 0.1.3 — use scripts/prepare-dsh.mjs; extraResources copies dsh-runtime → resources/dsh");
process.exit(0);
