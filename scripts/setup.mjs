#!/usr/bin/env node
// 一次性安装：初始化子模块 → 构建 magpie → 提示首次设置
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });

if (!fs.existsSync(path.join(root, "vendor", "magpie", "go.mod"))) {
  console.log("初始化子模块 vendor/magpie …");
  run("git", ["submodule", "update", "--init", "--depth", "1", "vendor/magpie"]);
}
run(process.execPath, [path.join(root, "scripts", "build-magpie.mjs"), ...process.argv.slice(2)]);
console.log("\n下一步：npm run init（填写模型 API Key 与飞书凭据，可跳过改在界面中设置）→ npm start");
