import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AboutMe, AboutMeError, isIdOrCard, isPasswordLike, sensitiveKind, type BotContext } from "../src/agent/about-me.js";
import { MemoryStore } from "../src/agent/memory.js";

const dirs: string[] = [];
function fresh(now = () => Date.now()): AboutMe {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-aboutme-"));
  dirs.push(dir);
  return new AboutMe(dir, now);
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const ctx = (o: Partial<BotContext> = {}): BotContext => ({ botId: "a", botName: "产品助理", conversationId: "a:web:console", session: "s1", turnSince: 0, explicit: false, cards: true, ...o });

describe("关于我：识别", () => {
  it("PRD R2 的五句：地址、电话、邮箱先问；证件号、银行卡号不存；密码类不存也不问", () => {
    expect(sensitiveKind("寄到杭州市西湖区文三路 100 号")).toBe("address");
    expect(sensitiveKind("Melody 的收件地址是上海市徐汇区某路 88 号")).toBe("address");
    expect(sensitiveKind("我的手机号 13800000000")).toBe("phone");
    expect(sensitiveKind("邮箱 melody@example.com")).toBe("email");
    expect(isIdOrCard("身分證字號 A123456789")).toBe(true);
    expect(isPasswordLike("我的密碼是 example123")).toBe(true);
    expect(isPasswordLike("我使用密碼管理工具")).toBe(false);
    expect(isIdOrCard("身份证 110101199001011234")).toBe(true);
    expect(isIdOrCard("卡号 6222000000000000")).toBe(true);
    expect(isPasswordLike("我的密码是 abc123")).toBe(true);
    // 城市不是地址，日常的话不算敏感
    expect(sensitiveKind("Melody 住在杭州")).toBeUndefined();
    expect(sensitiveKind("称呼用户为 Melody")).toBeUndefined();
    expect(sensitiveKind("每天 9 点开会")).toBeUndefined();
    expect(isIdOrCard("Melody 是 AnyModelBot 的产品经理")).toBe(false);
  });
});

describe("关于我：对话里记下和撤销", () => {
  it("记下、撤销后恢复原样、变更历史多一条，再说一次仍能记下", async () => {
    const me = fresh();
    const r = await me.botAdd("称呼用户为 Melody", ctx());
    expect(r.kind).toBe("added");
    expect(me.text()).toContain("称呼用户为 Melody");
    const id = r.kind === "added" ? r.change.id : "";
    me.undo(id);
    expect(me.lines()).toEqual([]);
    expect(me.history()).toHaveLength(2);
    expect(me.history().find((h) => h.id === id)?.undoable).toBe(false);
    expect((await me.botAdd("称呼用户为 Melody", ctx({ session: "s2" }))).kind).toBe("added");
  });

  it("一次回复最多记 3 句；关掉开关后只读", async () => {
    const me = fresh();
    for (const t of ["一", "二", "三"]) expect((await me.botAdd(`事实${t}`, ctx())).kind).toBe("added");
    expect((await me.botAdd("事实四", ctx())).kind).toBe("perTurn");
    expect((await me.botAdd("事实四", ctx({ turnSince: Date.now() + 1 }))).kind).toBe("added");
    me.setEnabled(false);
    expect((await me.botAdd("事实五", ctx({ turnSince: Date.now() + 1 }))).kind).toBe("off");
    expect(me.botForget("事实一", ctx()).kind).toBe("off");
    // 用户自己仍能改、删、写
    expect(me.userAdd("自己写的一句").op).toBe("add");
  });

  it("密码不写、证件号和卡号不写", async () => {
    const me = fresh();
    expect((await me.botAdd("用户的密码是 abc123", ctx())).kind).toBe("secret");
    expect((await me.botAdd("用户的身份证号 110101199001011234", ctx())).kind).toBe("idOrCard");
    expect(() => me.userAdd("卡号 6222000000000000")).toThrow(AboutMeError);
  });

  it("敏感先问：记下算你改过；只这次用不写；同一段对话里同一个值不再问；聊天软件里只这次用", async () => {
    const me = fresh();
    const r = await me.botAdd("Melody 的收件地址是杭州市西湖区文三路 100 号", ctx());
    expect(r.kind).toBe("sensitive");
    expect(me.lines()).toEqual([]);
    expect((await me.botAdd("Melody 的收件地址是杭州市西湖区文三路 100 号", ctx())).kind).toBe("sensitiveAsked");
    const p = r.kind === "sensitive" ? r.proposal : undefined;
    me.decide(p!.id, true);
    expect(me.lines()[0]).toMatchObject({ text: "Melody 的收件地址是杭州市西湖区文三路 100 号", locked: true, source: "you", sensitive: "address" });
    const phone = await me.botAdd("Melody 的手机号 13800000000", ctx());
    if (phone.kind !== "sensitive") throw new Error(phone.kind);
    expect(me.decide(phone.proposal.id, false).status).toBe("once");
    expect(me.lines()).toHaveLength(1);
    expect((await me.botAdd("Melody 的邮箱 melody@example.com", ctx({ cards: false }))).kind).toBe("sensitiveOnce");
  });

  it("你改过的不改回：机器人只出建议卡，点「改成这样」后仍带锁；同一段对话不再出", async () => {
    const me = fresh();
    me.userAdd("称呼用户为 Melody，不叫阿伯");
    const r = await me.botAdd("称呼用户为 Mel", ctx(), "称呼用户为 Melody");
    if (r.kind !== "locked" || !r.proposal) throw new Error(r.kind);
    expect(me.lines()[0].text).toBe("称呼用户为 Melody，不叫阿伯");
    expect(((await me.botAdd("称呼用户为 Mel", ctx(), "称呼用户为 Melody")) as { asked?: boolean }).asked).toBe(true);
    me.decide(r.proposal.id, true);
    expect(me.lines()[0]).toMatchObject({ text: "称呼用户为 Mel", locked: true });
    // 聊天软件里：不出建议卡
    expect((await me.botAdd("称呼用户为 M", ctx({ cards: false, session: "s9" }), "称呼用户为 Mel")).kind).toBe("locked");
  });

  it("你删掉的不再记回：顺口说不记，亲口明确再说才记；撤销删除解除", async () => {
    const me = fresh();
    me.userAdd("Melody 在杭州");
    const del = me.userDelete(me.lines()[0].id);
    expect((await me.botAdd("Melody 在杭州", ctx())).kind).toBe("suppressed");
    // 换个说法：由小模型判断是同一件事
    expect((await me.botAdd("用户人在杭州", ctx({ judge: async () => 0 }))).kind).toBe("suppressed");
    expect((await me.botAdd("Melody 住在杭州", ctx({ explicit: true }))).kind).toBe("added");
    const me2 = fresh();
    me2.userAdd("Melody 在杭州");
    const d2 = me2.userDelete(me2.lines()[0].id);
    me2.undo(d2.id);
    expect(me2.lines()[0].text).toBe("Melody 在杭州");
    expect((await me2.botForget("在杭州", ctx())).kind).toBe("deleted");
    expect(del.op).toBe("delete");
  });

  it("替换：新事实以最新为准，旧句进变更历史；之后改过就不能撤销那次", async () => {
    const me = fresh();
    const a = await me.botAdd("Melody 在上海", ctx());
    const b = await me.botAdd("Melody 在杭州", ctx(), "在上海");
    expect(b.kind).toBe("edited");
    expect(me.text()).toBe("- Melody 在杭州");
    expect(me.history().find((h) => a.kind === "added" && h.id === a.change.id)?.undoable).toBe(false);
    if (b.kind === "edited") me.undo(b.change.id);
    expect(me.text()).toBe("- Melody 在上海");
  });

  it("变更历史保留 30 天；渠道里回「撤销」撤销上一轮记下的", async () => {
    let now = 1_000_000;
    const me = fresh(() => now);
    await me.botAdd("称呼用户为 Melody", ctx());
    now += 31 * 86400_000;
    me.userAdd("另一句");
    expect(me.history()).toHaveLength(1);
    await me.botAdd("Melody 喜欢简短", ctx({ turnSince: now }));
    expect(me.undoRecent("a:web:console", now - 1)).toHaveLength(1);
    expect(me.text()).not.toContain("简短");
  });
});

describe("关于我：从团队记忆搬过来", () => {
  it("原样搬进来，标原团队记忆，不算你改过；提示一次；没有条目时不提示", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "amb-team-"));
    dirs.push(root);
    const mem = new MemoryStore(root);
    mem.remember({ kind: "team", id: "" }, "称呼用户为 Melody", { source: "chat:web" });
    mem.remember({ kind: "team", id: "" }, "第三节线稿统一用灰阶", { source: "chat:web", topic: "design" });
    const me = new AboutMe(root);
    expect(me.migrate(mem)).toBe(2);
    expect(me.lines().every((l) => l.source === "team" && !l.locked)).toBe(true);
    expect(me.notice).toBe(true);
    me.dismissNotice();
    expect(new AboutMe(root).notice).toBe(false);
    expect(new AboutMe(root).migrate(mem)).toBe(0);
    const empty = fresh();
    expect(empty.migrate(new MemoryStore(empty.root))).toBe(0);
    expect(empty.notice).toBe(false);
  });
});
