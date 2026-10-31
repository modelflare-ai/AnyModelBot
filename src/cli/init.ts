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
import { t as tr } from "../i18n/index.js";

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
      if (!tty) stdout.write(secret ? tr("cli.entered") + "\n" : `${l ?? ""}\n`);
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
  console.log("\n" + tr("cli.done"));
}

async function setup(app: App, rl: ReturnType<typeof lineReader>, dataDir: string): Promise<void> {
  console.log(tr("cli.title", { dir: dataDir }) + "\n");
  if (app.magpie) {
    if (!app.magpie.binPath) {
      throw new Error(tr("cli.noMagpie"));
    }
    await app.magpie.start();
    const status = app.modelflareStatus();
    const account = app.ensureAccount();
    if (status.connected) {
      console.log(tr("cli.alreadyConnected", { tail: status.keyTail, account: account.signedIn ? tr("cli.accountSuffix", { name: account.status().name || tr("cli.signedIn") }) : "" }));
    } else {
      const how = (await rl.ask(tr("cli.askHow"))).toLowerCase();
      if (how !== "skip") {
        const line = (await rl.ask(tr("cli.askLine"))).trim() === "cn" ? "cn" : "auto";
        if (how === "key") {
          const key = await rl.ask("Modelflare API Key：", true);
          const r = await app.connectModelflare(key, line);
          if (!r.ok) throw new Error(r.message + (r.suggestLine === "cn" ? tr("cli.tryCn") : ""));
          console.log(tr("cli.connected", { count: r.models.length }));
        } else {
          await app.setModelflareLine(line);
          await loginInBrowser(app);
        }
      }
    }
  }
  const appId = (await rl.ask(tr("cli.askFeishuId"))).trim();
  if (appId) {
    const secret = await rl.ask(tr("cli.askFeishuSecret"), true);
    let bot = app.store.listBots()[0];
    if (!bot) bot = app.store.createBot({ id: "default", name: tr("app.default_bot_name"), weixinEnabled: true });
    app.store.updateBot(bot.id, { feishuAppId: appId, feishuAppSecret: secret });
    console.log(tr("cli.savedToBot", { name: bot.name }));
  }
}

/** 浏览器登录：回调落在本机 127.0.0.1，所以浏览器必须在这台电脑上（SSH 远程请改用 API Key） */
async function loginInBrowser(app: App): Promise<void> {
  const account = app.ensureAccount();
  const url = await account.startLogin();
  console.log(`\n${tr("cli.openLink")}\n${url}\n`);
  openInBrowser(url);
  for (;;) {
    await new Promise((r) => setTimeout(r, 500));
    const s = account.status();
    if (s.state === "signed_in") {
      const models = await app.runtime.listModels(true).catch(() => []);
      console.log(tr("cli.signedInConnected", { name: s.name || "Modelflare", count: models.length }));
      return;
    }
    if (s.state !== "signing_in") throw new Error(s.error || tr("cli.loginIncomplete"));
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
  console.error(tr("cli.setupFailed"), (e as Error).message);
  process.exit(1);
});
