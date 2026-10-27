/** 终端扫码登录微信 iLink：二维码打印到终端并保存为 PNG。用法：npm run weixin:login [botId] */
import path from "node:path";
import { loadConfig } from "../config.js";
import { Store } from "../store/db.js";
import { WeixinLogin } from "../channels/weixin/login.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new Store(path.join(config.dataDir, "anymodel.db"));
  const botId = process.argv[2] || store.listBots()[0]?.id || "default";
  if (!store.getBot(botId)) store.createBot({ id: botId, name: "我的助手", weixinEnabled: true });
  const login = new WeixinLogin({
    apiBaseUrl: config.weixin.apiBaseUrl,
    pngPath: path.join(config.dataDir, "weixin", `${botId}-login-qr.png`),
    printTerminal: true,
  });
  login.subscribe((s) => s.message && console.log(`[${s.state}] ${s.message}`));
  const res = await login.run();
  if (!res) process.exit(1);
  store.saveWeixinAccount({ botId, botToken: res.botToken, ilinkBotId: res.ilinkBotId, baseUrl: res.baseUrl, ownerUserId: res.userId });
  store.updateBot(botId, { weixinEnabled: true });
  store.close();
  console.log("✓ 微信已连接，运行 npm start 开始收发消息（若已在运行，请重启或在界面中重新启用微信渠道）。");
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
