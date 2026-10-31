// modelflare：zh 与 en 的键必须一一对应（en 的类型由 zh 推出，少一个多一个都过不了类型检查）。
import type { Catalog } from "../types.js";

export const zh = {
  unreachable: "连不上 {host}（{reason}）",
  timeout: "超时",
  invalid_key: "Key 无效或已被撤销",
  forbidden: "这个 Key 没有权限调用该模型或分组",
  unavailable: "Modelflare 暂时不可用（HTTP {status}）{retry}",
  retry_after: "，{s} 秒后重试",
  bad_models: "Modelflare 返回了无法识别的模型列表",
  balance_failed: "读取余额失败（HTTP {status}）",
  bad_balance: "Modelflare 返回了无法识别的余额",
} satisfies Catalog;

export const en: Catalog<typeof zh> = {
  unreachable: "Can't reach {host} ({reason})",
  timeout: "timed out",
  invalid_key: "The key is invalid or has been revoked",
  forbidden: "This key isn't allowed to use this model or group",
  unavailable: "Modelflare is temporarily unavailable (HTTP {status}){retry}",
  retry_after: "; retry in {s}s",
  bad_models: "Modelflare returned a model list we couldn't read",
  balance_failed: "Couldn't read the balance (HTTP {status})",
  bad_balance: "Modelflare returned a balance we couldn't read",
};
