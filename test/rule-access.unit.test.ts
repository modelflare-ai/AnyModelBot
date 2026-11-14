import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { App } from "../src/app.js";
import { loadConfig } from "../src/config.js";

it("规则管理使用可信发送者身份，飞书群会话 ID 不必等于主人的私聊 ID", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-rule-access-"));
  const app = new App(loadConfig({ dataDir: dir, env: { AMB_MAGPIE_BASE_URL: "http://127.0.0.1:9/v1", AMB_AGENT: "off", AMB_CATALOG: "off" } }), { printQrToTerminal: false });
  try {
    app.store.createBot({ id: "b", name: "b" });
    const dm = app.store.ensureConversation("b", "feishu", "oc_owner");
    const group = app.store.ensureConversation("b", "feishu", "oc_group", "群", "group");
    app.store.putAccess({ id: "owner", botId: "b", channel: "feishu", peerId: dm.peerId, senderId: "ou_owner", name: "owner", status: "owner", source: "first-message", code: "", text: "", requests: 0, createdAt: 1, updatedAt: 1, decidedAt: 1, decidedBy: "", repliedAt: 0, notifiedAt: 0 });
    app.store.setAgentSession(group.id, "b", "session");
    const rule = app.tasks.createRule({ botId: "b", conversationId: dm.id, title: "主人规则", instruction: "报告进展", schedule: { kind: "daily", time: "08:00", tz: "UTC" } }).rule!;
    const call = () => app.tasks.chatTool({ botId: "b", sessionId: "session", op: "rule_update", args: { rule: rule.id, mode: "off", senderId: "ou_owner" } });
    // 工具参数伪造的发送者不参与授权。
    app.agent.turnsInProgress.set(group.id, { botId: "b", senderId: "ou_guest" } as any);
    expect((await call()).error).toBeTruthy();
    app.agent.turnsInProgress.set(group.id, { botId: "b", senderId: "ou_owner" } as any);
    expect((await call()).error).toBeUndefined();
    expect(app.store.getRule(rule.id)?.mode).toBe("off");
  } finally {
    app.agent.turnsInProgress.clear();
    await app.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
