/**
 * 首次设置向导（终端版；界面里也能完成同样的设置）：
 * 1. 连接 Modelflare：登录账户（打印登录链接，在这台电脑的浏览器里完成），或粘贴 API Key
 *    （先校验 GET /v1/models，再写入内置网关的隔离配置；key 不进命令行参数）
 * 2. 飞书 App ID / App Secret → 写入本程序数据库
 */
import readline from "node:readline";
import { spawn } from "node:child_process";
import { stdin, stdout } from "node:process";
import { loadConfig } from "../config.js";
import { App } from "../app.js";

/** 行队列：兼容交互终端与管道输入（管道时所有行会一次性到达） */
function lineReader() {
  const tty = !!stdin.isTTY;
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: tty });
  const lines: string[] = [];
  const waiters: Array<(l: string | undefined) => void> = [];
  let closed = false;
  let muted = false;
  const r = rl as unknown as { _writeToOutput?: (s: string) => void };
  const orig = r._writeToOutput?.bind(rl);
  r._writeToOutput = (str: string) => {
    if (!muted) return orig?.(str);
    if (str.includes("\n") || str.includes("\r")) stdout.write("\n");
    else if (!str.startsWith("\x1b")) stdout.write("*".repeat([...str].length));
  };
  rl.on("line", (l) => (waiters.length ? waiters.shift()!(l) : lines.push(l)));
  rl.on("close", () => {
    closed = true;
    while (waiters.length) waiters.shift()!(undefined);
  });
  const next = () => (lines.length ? Promise.resolve(lines.shift()) : closed ? Promise.resolve(undefined) : new Promise<string | undefined>((res) => waiters.push(res)));
  return {
    async ask(q: string, secret = false): Promise<string> {
      stdout.write(q);
      muted = secret && tty;
      const l = await next();
      muted = false;
      if (!tty) stdout.write(secret ? "（已输入）\n" : `${l ?? ""}\n`);
      return (l ?? "").trim();
    },
    close: () => rl.close(),
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = new App(config, { noWeb: true });
  const rl = lineReader();
  try {
    await setup(app, rl, config.dataDir);
  } finally {
    rl.close();
    await app.magpie?.stop();
    app.store.close();
  }
  console.log("\n完成。运行 npm start 启动；微信请在管理界面的信息面板「渠道」里扫码，或运行 npm run weixin:login。");
}

async function setup(app: App, rl: ReturnType<typeof lineReader>, dataDir: string): Promise<void> {
  console.log(`anymodel bot 首次设置（数据目录：${dataDir}）\n`);
  if (app.magpie) {
    if (!app.magpie.binPath) {
      throw new Error("找不到 magpie 可执行文件，请先运行：npm run setup");
    }
    await app.magpie.start();
    const status = app.modelflareStatus();
    const account = app.ensureAccount();
    if (status.connected) {
      console.log(`Modelflare 已连接（尾号 ${status.keyTail}${account.signedIn ? `，账户 ${account.status().name || "已登录"}` : ""}），保留现有连接。`);
    } else {
      const how = (await rl.ask("连接 Modelflare：回车 = 登录账户（在这台电脑的浏览器里完成），输入 key = 粘贴 API Key，输入 skip = 稍后在界面里连接：")).toLowerCase();
      if (how !== "skip") {
        const line = (await rl.ask("线路：回车 = 国际（modelflare.dev），输入 cn = 中国大陆优化（origin.modelflare.dev）：")).trim() === "cn" ? "cn" : "auto";
        if (how === "key") {
          const key = await rl.ask("Modelflare API Key：", true);
          const r = await app.connectModelflare(key, line);
          if (!r.ok) throw new Error(r.message + (r.suggestLine === "cn" ? "（可重试并选择 cn 线路）" : ""));
          console.log(`✓ 已连接 Modelflare，找到 ${r.models.length} 个模型`);
        } else {
          await app.setModelflareLine(line);
          await loginInBrowser(app);
        }
      }
    }
  }
  const appId = (await rl.ask("飞书 App ID（cli_xxx，留空跳过）：")).trim();
  if (appId) {
    const secret = await rl.ask("飞书 App Secret：", true);
    let bot = app.store.listBots()[0];
    if (!bot) bot = app.store.createBot({ id: "default", name: "我的助手", weixinEnabled: true });
    app.store.updateBot(bot.id, { feishuAppId: appId, feishuAppSecret: secret });
    console.log(`✓ 已保存到机器人「${bot.name}」`);
  }
}

/** 浏览器登录：回调落在本机 127.0.0.1，所以浏览器必须在这台电脑上（SSH 远程请改用 API Key） */
async function loginInBrowser(app: App): Promise<void> {
  const account = app.ensureAccount();
  const url = await account.startLogin();
  console.log(`\n在这台电脑的浏览器里打开下面的链接，登录（或注册）Modelflare 并点「继续」授权：\n${url}\n`);
  openInBrowser(url);
  for (;;) {
    await new Promise((r) => setTimeout(r, 500));
    const s = account.status();
    if (s.state === "signed_in") {
      const models = await app.runtime.listModels(true).catch(() => []);
      console.log(`✓ 已登录 ${s.name || "Modelflare"}，本机 Key 已连接，找到 ${models.length} 个模型`);
      return;
    }
    if (s.state !== "signing_in") throw new Error(s.error || "登录没有完成");
  }
}

/** 尽力打开系统浏览器；打不开也没关系，链接已经打印出来了。参数直接传给程序，不经过 shell */
function openInBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* 没有可用的打开方式 */
  }
}

main().catch((e) => {
  console.error("设置失败：", (e as Error).message);
  process.exit(1);
});
