import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

// 纯静态输出；站点域名只在页面里用占位符 {SITE_DOMAIN} 拼出来（见 src/lib/site.ts），这里不设 site。
export default defineConfig({
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory", inlineStylesheets: "auto" },
  integrations: [preact()],
  devToolbar: { enabled: false },
});
