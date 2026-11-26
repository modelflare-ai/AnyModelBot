import type { TranslatedCatalog } from "../../index.js";

export default {
  unreachable: "連不上 {host}（{reason}）。請檢查網路；如果在用Proxy 或 VPN，請開啟系統 Proxy 或 TUN 模式後重試",
  timeout: "逾時",
  invalid_key: "Key 無效或已被撤銷",
  forbidden: "這個 Key 沒有權限呼叫該模型或分組",
  unavailable: "Modelflare 暫時不可用（HTTP {status}）{retry}",
  retry_after: "，{s} 秒後重試",
  bad_models: "Modelflare 返回了無法識別的模型清單",
} satisfies TranslatedCatalog["modelflare"];
