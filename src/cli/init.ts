/**
 * 首次设置向导（终端版；界面里也能完成同样的设置）：
 * 1. 模型服务商 + API Key → 写入内置 magpie 的隔离配置（key 经 stdin 传给 magpie CLI）
 * 2. 飞书 App ID / App Secret → 写入本程序数据库
 */
import readline from "node:readline";
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
  console.log("\n完成。运行 npm start 启动；微信请在管理界面「渠道」页扫码，或运行 npm run weixin:login。");
}

async function setup(app: App, rl: ReturnType<typeof lineReader>, dataDir: string): Promise<void> {
  console.log(`anymodel bot 首次设置（数据目录：${dataDir}）\n`);
  if (app.magpie) {
    if (!app.magpie.binPath) {
      throw new Error("找不到 magpie 可执行文件，请先运行：npm run setup");
    }
    await app.magpie.start();
    const preset = (await rl.ask("模型服务商预设（如 deepseek / openai / anthropic / moonshot-cn / qwen-cn，留空跳过；运行 build/bin/magpie presets 查看全部）：")).trim();
    if (preset) {
      const key = await rl.ask(`${preset} API Key：`, true);
      if (key) {
        const id = await app.magpie.addPresetProvider(preset, key);
        console.log(`✓ 已添加服务商 ${id}`);
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

main().catch((e) => {
  console.error("设置失败：", (e as Error).message);
  process.exit(1);
});
