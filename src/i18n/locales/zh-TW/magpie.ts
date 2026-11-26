import type { TranslatedCatalog } from "../../index.js";

export default {
  no_binary_cli: "找不到 magpie 執行檔，請先執行 npm run setup",
  no_binary: "找不到 magpie 執行檔（執行 npm run setup 從 vendor/magpie 建置）",
  unsupported_url: "不支援的 Modelflare 位址",
  missing_key: "缺少 API Key",
  create_failed: "建立 Modelflare 連線失敗：{detail}",
  not_running: "模型閘道未執行，稍後再試",
  disconnect_failed: "斷開失敗：HTTP {status} {body}",
  save_failed: "儲存失敗：HTTP {status} {body}",
  verify_failed: "儲存後驗證失敗",
} satisfies TranslatedCatalog["magpie"];
