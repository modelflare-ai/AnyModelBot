/**
 * 崩溃测试用的子进程：起一个真实 App（外部模型端点 + mock iLink，不开网页），打印 READY 后一直运行，直到被 kill -9。
 * 用法：node --import tsx test/fixtures/app-child.ts <dataDir> <llmUrl> <ilinkUrl> <cdnBase>
 */
import { App } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";

const [dataDir, llmUrl, ilinkUrl, cdnBase] = process.argv.slice(2);
const app = new App(
  loadConfig({ dataDir, env: { AMB_MAGPIE_BASE_URL: `${llmUrl}/v1`, AMB_MAGPIE_API_KEY: "gw-key", AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: ilinkUrl, AMB_WEIXIN_CDN_BASE: cdnBase, AMB_AGENT: "off" } }),
  { weixinPollTimeoutMs: 2000, printQrToTerminal: false, noWeb: true },
);
await app.start();
console.log("READY");
