/**
 * 「我的技能库」和「从本机导入…」的界面（真实浏览器，PRD 2026-11-25）：
 * 库页面空态 → 从本机导入（初始不勾选、下一步才读、确认导入、结果汇总）→ 库里出现「本机导入 · 暂未使用」→
 * 机器人设置 › 技能 › 从技能库添加… → 列表里出现并开着。网页端（没有桌面外壳）说明要在桌面端查找。没有浏览器的最小 CI 镜像上跳过。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { findAppRoot } from "../src/magpie/supervisor.js";
import { mockOpenAI, signIn } from "./helpers.js";

const require = createRequire(import.meta.url);
let chromium: any;
try { ({ chromium } = require("playwright")); }
catch { try { ({ chromium } = require(require.resolve("playwright-core", { paths: [path.join(import.meta.dirname, "../site")] }))); } catch { /* Browser QA is optional on minimal CI images. */ } }
const chrome = process.env.AMB_TEST_CHROME || chromium?.executablePath();
const browserAvailable = !!chromium && chrome && fs.existsSync(chrome);

let app: App, llm: Awaited<ReturnType<typeof mockOpenAI>>, root: string, home: string, base: string, browser: any;
const shots = process.env.AMB_TEST_SHOTS;

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amb-lib-e2e-")));
  home = path.join(root, "home");
  const put = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), text);
  };
  put(".claude/skills/weekly-report/SKILL.md", "---\nname: weekly-report\ndescription: Weekly reports\n---\n# 运营周报\nSteps\n");
  put(".claude/skills/weekly-report/scripts/build.py", "print(1)");
  put(".codex/skills/interview/SKILL.md", "---\nname: interview\ndescription: Customer interviews\nallowed-tools: Bash\n---\n# 客户访谈\nSteps\n");
  llm = await mockOpenAI({ models: ["gpt-4o-mock"], reply: () => "好的" });
  app = new App(loadConfig({ dataDir: path.join(root, "data"), env: { AMB_MAGPIE_BASE_URL: llm.url + "/v1", AMB_MAGPIE_API_KEY: "test-key", AMB_UI_PORT: "0", AMB_WEIXIN_API_BASE: "http://127.0.0.1:9", AMB_DEFAULT_MODEL: "gpt-4o-mock" } }), { printQrToTerminal: false });
  (app.localImports as any).home = home;
  await app.start();
  base = app.web!.url.replace(/\/$/, "");
  fs.mkdirSync(path.join(findAppRoot(), "test-results"), { recursive: true });
  if (browserAvailable) browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.stop();
  await llm?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!browserAvailable)("我的技能库界面", () => {
  it("网页端：说明要在技能库所在电脑的桌面端查找", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, locale: "zh-CN" });
    await signIn(page, base);
    await page.addInitScript(() => { try { localStorage.setItem("amb-lang", "zh-CN"); } catch { /* 私密窗口 */ } });
    try {
      await page.goto(`${base}/#/skills/library`);
      await page.getByRole("heading", { name: "我的技能库" }).waitFor();
      await page.getByText("还没有技能，可导入或在对话中保存。").waitFor();
      await page.getByRole("button", { name: "从本机导入…" }).click();
      await page.getByText("请在技能库所在电脑的桌面端查找").waitFor();
      await page.getByRole("button", { name: "关闭", exact: true }).last().click();
    } finally {
      await page.close();
    }
  });

  it("桌面端：找到 → 多选 → 预览 → 导入 → 库里出现 → 从技能库添加到机器人", async () => {
    (app as any).desktop = { ...(app.desktop ?? {}), pickFolder: async () => undefined };
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, locale: "zh-CN" });
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    await signIn(page, base);
    await page.addInitScript(() => { try { localStorage.setItem("amb-lang", "zh-CN"); } catch { /* 私密窗口 */ } });
    try {
      await page.goto(`${base}/#/skills/library`);
      await page.getByRole("button", { name: "从本机导入…" }).click();
      const dialog = page.getByRole("dialog", { name: "从本机导入技能" });
      await dialog.getByText("weekly-report", { exact: true }).waitFor();
      await dialog.getByText("interview", { exact: true }).waitFor();
      // 初始不勾选，下一步不可点
      expect(await dialog.getByRole("button", { name: "下一步" }).isDisabled()).toBe(true);
      await dialog.getByText("尚未读取正文").first().waitFor();
      if (shots) await page.screenshot({ path: path.join(shots, "discover.png") });
      await dialog.getByRole("checkbox", { name: "全选" }).check();
      await dialog.getByText("选中 2 项；下一步只读取所选完整技能目录。").waitFor();
      await dialog.getByRole("button", { name: "下一步" }).click();
      const review = page.getByRole("dialog", { name: "确认导入" });
      await review.getByText("运营周报").waitFor();
      await review.getByText("可导入 · 含脚本，导入不会执行 · 依赖尚未验证").waitFor();
      await review.getByText(/不兼容：含当前环境无法等价保持的限制（allowed-tools）/).waitFor();
      if (shots) await page.screenshot({ path: path.join(shots, "preview.png") });
      await review.getByRole("button", { name: "确认导入" }).click();
      const result = page.getByRole("dialog", { name: "导入结果" });
      await result.getByText("已入库1项，跳过1项，失败0项").waitFor();
      await result.getByText("不兼容：含当前环境无法等价保持的限制（allowed-tools）").waitFor();
      if (shots) await page.screenshot({ path: path.join(shots, "result.png") });
      await result.getByRole("button", { name: "完成" }).click();
      const row = page.locator(".ml-row", { hasText: "运营周报" });
      await row.getByText("本机导入").waitFor();
      await row.getByText("暂未使用").waitFor();
      if (shots) await page.screenshot({ path: path.join(shots, "library.png") });

      // 机器人设置：从技能库添加…
      await page.goto(`${base}/#/bot/default/settings/skills`);
      await page.getByRole("button", { name: "从技能库添加…" }).click();
      const add = page.getByRole("dialog", { name: "从技能库添加" });
      await add.locator(".la-row", { hasText: "运营周报" }).getByRole("checkbox").check();
      await add.getByRole("button", { name: "添加", exact: true }).click();
      await page.getByText("已添加 1 项").waitFor();
      const skillRow = page.locator(".skill-list .row", { hasText: "运营周报" });
      await skillRow.getByText("来源：本机导入").waitFor();
      expect(await skillRow.getByRole("switch").getAttribute("aria-checked")).toBe("true");
      if (shots) await page.screenshot({ path: path.join(shots, "bot-skills.png"), fullPage: true });
      // 回到库：阿白（默认机器人）使用中
      await page.goto(`${base}/#/skills/library`);
      await page.locator(".ml-row", { hasText: "运营周报" }).getByText(/使用中/).waitFor();
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
