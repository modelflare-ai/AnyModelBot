// magpie：zh 与 en 的键必须一一对应（en 的类型由 zh 推出，少一个多一个都过不了类型检查）。
import type { Catalog } from "../types.js";

export const zh = {
  no_binary_cli: "找不到 magpie 可执行文件，请先运行 npm run setup",
  no_binary: "找不到 magpie 可执行文件（运行 npm run setup 从 vendor/magpie 构建）",
  unsupported_url: "不支持的 Modelflare 地址",
  missing_key: "缺少 API Key",
  create_failed: "创建 Modelflare 连接失败：{detail}",
  not_running: "模型网关未运行，稍后再试",
  disconnect_failed: "断开失败：HTTP {status} {body}",
  save_failed: "保存失败：HTTP {status} {body}",
  verify_failed: "保存后校验失败",
} satisfies Catalog;

export const en: Catalog<typeof zh> = {
  no_binary_cli: "magpie executable not found. Run npm run setup first",
  no_binary: "magpie executable not found (run npm run setup to build it from vendor/magpie)",
  unsupported_url: "Unsupported Modelflare address",
  missing_key: "API key is missing",
  create_failed: "Couldn't create the Modelflare connection: {detail}",
  not_running: "The model gateway isn't running. Try again shortly",
  disconnect_failed: "Disconnect failed: HTTP {status} {body}",
  save_failed: "Save failed: HTTP {status} {body}",
  verify_failed: "Verification failed after saving",
};
