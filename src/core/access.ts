/**
 * 谁能和机器人对话：默认只有主人。代理跑在用户自己的电脑上（甚至可能是完全权限），陌生人找到机器人也不能驱动它。
 *
 * - 主人：微信 = 扫码登录的那个微信；飞书（以及没拿到扫码者的微信）= 连上之后第一个发单聊消息的人
 *   （先到先得；这条消息照常处理）。机器人设置里可以「更换」：清掉主人，下一个发消息的人成为主人。
 * - 其他人发消息：登记成使用请求，只回一句"还没被允许"（同一个人每小时最多一次），不进队列、不碰模型、不花钱；
 *   请求出现在信息面板里，也会带配对码发给主人（每个机器人每小时最多 3 条），主人回复「同意 1234」即可。
 * - 允许的人进允许名单，在机器人设置里能看到、能移除；被拒绝的人不再回复。
 * - 本机网页控制台本来就可信；群聊目前没有渠道接入（飞书只收单聊，微信 iLink 没有群），保持原样不拦，接入群聊时再定规则。
 */
import crypto from "node:crypto";
import type { InboundEvent } from "./types.js";
import { eventText } from "./types.js";
import type { AccessEntry, Store } from "../store/db.js";
import { logger } from "../log.js";
import { t as tr } from "../i18n/index.js";

const log = logger("access");

/** 陌生人收到的那一句 */
export const refusalText = () => tr("access.refusal");
/** 同一个陌生人多久最多回一次 */
export const REFUSE_EVERY_MS = 3600_000;
/** 每个机器人每小时最多给主人发几条使用请求通知（其余只在应用里显示） */
export const NOTICE_LIMIT = 3;
const NOTICE_WINDOW_MS = 3600_000;
export const approvedText = () => tr("access.approved");

export type AccessChannel = "weixin" | "feishu";
export const ACCESS_CHANNELS: AccessChannel[] = ["weixin", "feishu"];
const channelLabel = (c: string) => (c === "weixin" ? tr("access.chWeixin") : c === "feishu" ? tr("access.chFeishu") : c === "web" ? tr("access.chWeb") : c);

/** 主动发一条通知（App 经渠道和出站队列发）；发不出去（对方 24 小时内没说过话、渠道没开）返回 false */
export type Notify = (to: { botId: string; channel: string; peerId: string }, text: string, id: string) => boolean;

export interface Owner {
  peerId: string;
  /** login = 扫码登录的微信；first-message = 连上之后第一个发消息的人 */
  via: "login" | "first-message";
  entryId?: string;
}

/** 平台 id 太长：只留末尾几位，主人对得上就行 */
export function shortPeer(id: string): string {
  const s = id.replace(/@im\.wechat$/, "");
  return s.length > 10 ? `…${s.slice(-6)}` : s;
}

/** 名字，没有名字时是 id 的末尾几位 */
export function peerName(e: Pick<AccessEntry, "peerId" | "senderId" | "name">): string {
  return e.name && e.name !== e.peerId ? e.name : shortPeer(e.senderId || e.peerId);
}

export function whoText(e: Pick<AccessEntry, "channel" | "peerId" | "senderId" | "name">): string {
  return tr("access.who", { channel: channelLabel(e.channel), name: peerName(e) });
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export class AccessControl {
  constructor(
    private store: Store,
    private opts: { notify?: Notify; now?: () => number } = {},
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /** 某个渠道的主人：微信优先用扫码登录的人，其余是连上之后第一个发消息的人 */
  owner(botId: string, channel: string): Owner | undefined {
    if (channel === "weixin") {
      const o = this.store.getWeixinAccount(botId)?.ownerUserId;
      if (o) return { peerId: o, via: "login" };
    }
    const e = this.store.listAccess({ botId, channel, status: "owner" })[0];
    return e ? { peerId: e.peerId, via: "first-message", entryId: e.id } : undefined;
  }

  private isOwner(ev: InboundEvent): boolean {
    if (ev.channel === "web") return true;
    return this.owner(ev.botId, ev.channel)?.peerId === ev.conversation.id;
  }

  /** 只判断，不登记（runtime.handle 里的兜底检查） */
  allowed(ev: InboundEvent): boolean {
    // 本机界面本来就可信
    if (ev.channel === "web") return true;
    // 群聊：目前没有渠道接入群聊，保持原样；接入时要在这里加规则（例如只响应主人 @ 机器人）
    if (ev.conversation.kind === "group") return true;
    if (this.isOwner(ev)) return true;
    const s = this.store.getAccess(ev.botId, ev.channel, ev.conversation.id)?.status;
    return s === "allowed" || s === "owner";
  }

  /**
   * 渠道入口（interceptReply 最前面）：允许的直接放行；其他人登记成使用请求并通知主人（限频），
   * 返回给他的一句话（同一个人每小时最多一次；被拒绝的人不回）。
   */
  admit(ev: InboundEvent): { ok: true } | { ok: false; reply?: string } {
    if (this.claimOwner(ev) || this.allowed(ev)) return { ok: true };
    const now = this.now();
    let e = this.store.getAccess(ev.botId, ev.channel, ev.conversation.id);
    if (e?.status === "denied") return { ok: false };
    if (!e) {
      e = this.store.putAccess({
        id: crypto.randomUUID(),
        botId: ev.botId,
        channel: ev.channel,
        peerId: ev.conversation.id,
        senderId: ev.sender.id,
        name: ev.sender.name ?? "",
        status: "pending",
        source: "request",
        code: this.newCode(),
        text: clip(eventText(ev).replace(/\s+/g, " "), 200),
        requests: 1,
        createdAt: now,
        updatedAt: now,
        decidedAt: 0,
        decidedBy: "",
        repliedAt: 0,
        notifiedAt: 0,
      });
      log.info(`access request ${e.code}`, { bot: e.botId, channel: e.channel, peer: shortPeer(e.peerId) });
      this.notifyOwners(e);
    } else {
      this.store.updateAccess(e.id, { requests: e.requests + 1, updatedAt: now });
    }
    if (e.repliedAt && now - e.repliedAt < REFUSE_EVERY_MS) return { ok: false };
    this.store.updateAccess(e.id, { repliedAt: now });
    return { ok: false, reply: refusalText() };
  }

  /**
   * 这个渠道还没有主人（飞书刚连上、主人被更换、扫码时没拿到扫码者的微信）：第一个发单聊消息的人成为主人，
   * 他的这条消息照常处理。拒绝过的人不算。
   */
  private claimOwner(ev: InboundEvent): boolean {
    if (ev.channel === "web" || ev.conversation.kind === "group" || this.owner(ev.botId, ev.channel)) return false;
    const cur = this.store.getAccess(ev.botId, ev.channel, ev.conversation.id);
    if (cur?.status === "denied") return false;
    const now = this.now();
    const decided = { status: "owner" as const, code: "", decidedAt: now, decidedBy: "first-message", updatedAt: now };
    if (cur) this.store.updateAccess(cur.id, decided);
    else
      this.store.putAccess({
        id: crypto.randomUUID(),
        botId: ev.botId,
        channel: ev.channel,
        peerId: ev.conversation.id,
        senderId: ev.sender.id,
        name: ev.sender.name ?? "",
        source: "first-message",
        text: clip(eventText(ev).replace(/\s+/g, " "), 200),
        requests: 1,
        createdAt: now,
        repliedAt: 0,
        notifiedAt: 0,
        ...decided,
      });
    log.info("access owner claimed by the first message", { bot: ev.botId, channel: ev.channel, peer: shortPeer(ev.conversation.id) });
    return true;
  }

  /** 把新请求带配对码发给各渠道的主人（每个机器人每小时最多 NOTICE_LIMIT 条；超出的只在应用里显示） */
  private notifyOwners(e: AccessEntry): void {
    const now = this.now();
    if (this.store.accessNotifiedSince(e.botId, now - NOTICE_WINDOW_MS) >= NOTICE_LIMIT) {
      log.info("access notice rate-limited", { bot: e.botId, code: e.code });
      return;
    }
    const bot = this.store.getBot(e.botId);
    const said = e.text ? tr("access.said", { text: clip(e.text, 60) }) : "";
    const text = tr("access.ownerNotice", { bot: bot?.name ?? e.botId, who: whoText(e), said, code: e.code });
    let sent = false;
    for (const ch of ACCESS_CHANNELS) {
      const o = this.owner(e.botId, ch);
      if (o && this.opts.notify?.({ botId: e.botId, channel: ch, peerId: o.peerId }, text, `access:${e.id}:${ch}`)) sent = true;
    }
    if (sent) this.store.updateAccess(e.id, { notifiedAt: now });
  }

  /** 4 位配对码，不和待处理的请求、待批准的工具审批撞 */
  private newCode(): string {
    const used = new Set([...this.store.pendingAccessCodes(), ...this.store.listApprovals({ status: "pending", limit: 500 }).map((r) => r.code)]);
    for (let i = 0; i < 50; i++) {
      const c = String(crypto.randomInt(0, 10000)).padStart(4, "0");
      if (!used.has(c)) return c;
    }
    return String(crypto.randomInt(1000, 10000));
  }

  /**
   * 主人在聊天里处理请求：「同意 1234」/「拒绝 1234」（也接受 允许/批准/y/n 等）。
   * 只认主人（各渠道的主人和本机网页），只认这个机器人待处理请求的配对码；其余交给工具审批处理。
   */
  handleReply(ev: InboundEvent): { handled: boolean; ack?: string } {
    const m = /^(同意|允许|批准|通过|y|yes|ok|拒绝|不同意|n|no)\s*[#:：]?\s*(\d{4})$/i.exec(eventText(ev).trim());
    if (!m || !this.isOwner(ev)) return { handled: false };
    const e = this.store.pendingAccessByCode(ev.botId, m[2]);
    if (!e) return { handled: false };
    const allow = !/^(拒绝|不同意|n|no)$/i.test(m[1]);
    this.decide(e.id, allow, `${ev.channel}:${ev.sender.id}`);
    return { handled: true, ack: tr(allow ? "access.allowedAck" : "access.deniedAck", { who: whoText(e) }) };
  }

  /** 允许或拒绝一个请求（被拒绝的也可以改成允许）；允许时告诉对方一声 */
  decide(id: string, allow: boolean, by: string): AccessEntry | undefined {
    const e = this.store.getAccessById(id);
    if (!e || (e.status !== "pending" && !(allow && e.status === "denied"))) return undefined;
    const now = this.now();
    this.store.updateAccess(id, { status: allow ? "allowed" : "denied", code: "", decidedAt: now, decidedBy: by, updatedAt: now });
    log.info(`access ${allow ? "allowed" : "denied"}`, { bot: e.botId, channel: e.channel, peer: shortPeer(e.peerId), by });
    if (allow) this.opts.notify?.({ botId: e.botId, channel: e.channel, peerId: e.peerId }, approvedText(), `access:${id}:approved:${now}`);
    return this.store.getAccessById(id);
  }

  /**
   * 更换主人（机器人设置里的「更换」、飞书换了一个应用）：清掉这个渠道"第一个发消息"的主人，下一个发单聊消息的人成为主人。
   * 原来的主人移出名单（之后发消息要重新被允许，除非他就是下一个发消息的人）；keep 时留在允许名单里（扫码拿到了扫码者的微信）。
   * 扫码登录的微信主人不在这里，重新扫码就换了。
   */
  resetOwner(botId: string, channel: string, opts: { keep?: boolean } = {}): boolean {
    const now = this.now();
    const owners = this.store.listAccess({ botId, channel, status: "owner" });
    for (const o of owners) {
      if (opts.keep) this.store.updateAccess(o.id, { status: "allowed", source: "previous-owner", updatedAt: now });
      else this.store.deleteAccess(o.id);
      log.info("access owner reset", { bot: botId, channel, peer: shortPeer(o.peerId), kept: !!opts.keep });
    }
    return owners.length > 0;
  }

  /** 直接加入允许名单（迁移、换了扫码的微信、测试） */
  allow(botId: string, channel: string, peerId: string, source: string): AccessEntry {
    const now = this.now();
    const cur = this.store.getAccess(botId, channel, peerId);
    if (cur && (cur.status === "allowed" || cur.status === "owner")) return cur;
    return this.store.putAccess({
      id: cur?.id ?? crypto.randomUUID(),
      botId,
      channel,
      peerId,
      senderId: channel === "weixin" ? peerId : "",
      name: "",
      status: "allowed",
      source,
      code: "",
      text: "",
      requests: 0,
      createdAt: now,
      updatedAt: now,
      decidedAt: now,
      decidedBy: source,
      repliedAt: 0,
      notifiedAt: 0,
    });
  }

  /** 移除（允许名单里的人、被拒绝的人）：之后他再发消息会重新申请 */
  remove(id: string): boolean {
    const e = this.store.getAccessById(id);
    if (!e) return false;
    this.store.deleteAccess(id);
    log.info("access removed", { bot: e.botId, channel: e.channel, peer: shortPeer(e.peerId), was: e.status });
    return true;
  }

  /** 界面与 /status：主人、名单、待处理的请求 */
  view(botId: string) {
    const all = this.store.listAccess({ botId });
    const owners = Object.fromEntries(ACCESS_CHANNELS.map((ch) => [ch, this.owner(botId, ch) ?? null])) as Record<AccessChannel, Owner | null>;
    return {
      policy: "owner-allowlist" as const,
      owners,
      requests: all.filter((e) => e.status === "pending"),
      entries: all.filter((e) => e.status !== "pending"),
    };
  }

  /** /status 里的一行 */
  policyLine(botId: string): string {
    const v = this.view(botId);
    const allowed = v.entries.filter((e) => e.status === "allowed").length;
    const owners = ACCESS_CHANNELS.map((ch) => tr("access.ownerOf", { channel: channelLabel(ch), who: v.owners[ch] ? ` ${shortPeer(v.owners[ch]!.peerId)}` : tr("access.notSet") })).join(tr("access.listSep"));
    const req = v.requests.length ? tr("access.pendingRequests", { count: v.requests.length }) : "";
    return tr("access.policy", { owners, allowed, req });
  }
}
