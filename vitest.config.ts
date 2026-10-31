import { defineConfig } from "vitest/config";
export default defineConfig({
  // AMB_LANG：服务端"跟随系统"时的语言（src/i18n）。测试固定用简体中文，不受开发机 LANG 影响；英文由 i18n 测试单独覆盖
  test: { include: ["test/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000, pool: "forks", fileParallelism: false, env: { AMB_LANG: "zh-CN" } },
});
