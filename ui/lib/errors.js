// 任务 / 助手出错时给人看的样子（第 9 项）：把服务端、模型服务商的原始报错归成几类，
// 主提示用一句简明的话，状态码、request id、原始信息折叠起来，可以复制排障（复制前去掉凭据）。
// 只做归类和显示，不改服务端的报错，也不据此自动重试或换模型。
import { t } from "./i18n.js";

// 各类报错的特征（服务商和 Modelflare 的英文、中文报错都认）
const BALANCE = /insufficient[_ ]?(user[_ ])?(quota|balance|credit|funds)|余额不足|额度不足|quota (is )?(exceeded|not enough|insufficient)|not enough (quota|balance|credit)|unable to reserve quota|pre[- ]?consum|预扣费?(额度)?失败|credit balance is too low|exceeded your current quota/i; // i18n-ignore
const AUTH = /invalid[_ ]api[_ ]key|incorrect api key|\bunauthori[sz]ed\b|invalid[_ ]token|token (is )?(invalid|expired|revoked)|无效的令牌|令牌.{0,6}(无效|过期)|api key.{0,20}(invalid|expired|revoked|not valid)/i; // i18n-ignore
const MODEL = /model[_ ]not[_ ]found|model\b.{0,60}\b(does not exist|not found|not available|not supported|is not enabled)|no such model|unknown model|模型不存在|无可用渠道|no available channel|model_not_available/i; // i18n-ignore
const TOOLS = /unsupported.{0,60}(?:tools?|function)|(?:tools?|function.?calling).{0,70}(?:not supported|unsupported|not available)|(?:does not|doesn.t|cannot|can.t) support.{0,40}(?:tools?|function)|不支持.{0,12}(?:工具|函数)|(?:工具|函数)调用.{0,12}不支持/i; // i18n-ignore
const RATE = /rate[_ ]?limit|too many requests|请求过于频繁|overloaded/i; // i18n-ignore
const NETWORK = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR|fetch failed|socket hang up|network (error|is unreachable)|连不上|网络(错误|不可用|连接)/i; // i18n-ignore

/** 报错正文里的 HTTP 状态码（没有时 0） */
function statusOf(s) {
  const m =
    /\b(?:HTTP|status(?:[ _]code)?|code)["'\s:=]*([45]\d\d)\b/i.exec(s) ||
    /\b([45]\d\d)\s+(?:Bad Request|Unauthorized|Payment Required|Forbidden|Not Found|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b/i.exec(s) ||
    /\b([45]\d\d)\b/.exec(s);
  return m ? Number(m[1]) : 0;
}

/** 报错正文里的 request id（服务商和 Modelflare 的几种写法） */
function requestIdOf(s) {
  const m = /request[\s_-]?id["'\s:=]+([A-Za-z0-9_.:-]{6,})/i.exec(s) || /\breq_[A-Za-z0-9]{8,}\b/.exec(s);
  return m ? m[1] || m[0] : "";
}

/** 复制排障信息前去掉凭据：API Key、Bearer 令牌、key=… 这类参数 */
export function redact(s) {
  return String(s || "")
    .replace(/\b(sk|mf|pk|rk|key)-[A-Za-z0-9_-]{8,}/g, (k) => `${k.slice(0, 3)}…${k.slice(-4)}`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer …")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)(["'\s]*[:=]\s*["']?)[^\s"',}&]+/gi, "$1$2…");
}

/** 看起来是原始报错（JSON、带状态码、很长），而不是已经写好的提示 */
const looksRaw = (s) => /[{[]\s*"/.test(s) || statusOf(s) > 0 || s.length > 240;

/**
 * 归类：balance 余额 / 额度不足；auth 凭据失效；model 模型不存在或不可用；rate 限流；network 网络；
 * forbidden 其他 403（不当成欠费）；unfinished 其他。raw：正文是原始报错，主提示不直接显示它。
 */
export function classifyError(text) {
  const s = String(text || "");
  const status = statusOf(s);
  let kind = "unfinished";
  if (status === 402 || BALANCE.test(s)) kind = "balance";
  else if (status === 401 || AUTH.test(s)) kind = "auth";
  else if (TOOLS.test(s) || MODEL.test(s) || (status === 404 && /model/i.test(s))) kind = "model";
  else if (status === 429 || RATE.test(s)) kind = "rate";
  else if (NETWORK.test(s)) kind = "network";
  else if (status === 403) kind = "forbidden";
  return { kind, status, requestId: requestIdOf(s), raw: looksRaw(s), ...(kind === "model" && TOOLS.test(s) ? { toolsUnsupported: true } : {}) };
}

/**
 * 界面按钮发给目录 Bot 的操作（约定见 src/botkit/app-skill.ts）存成一条 "[ui-action] {json}\n说明" 的用户消息。
 * 显示时不给人看 JSON：有说明就显示说明，没有就是"在界面上操作：{type}"。存下的原文不变（Bot 仍按它执行）。
 */
export function uiActionOf(text) {
  const s = String(text || "");
  if (!s.startsWith("[ui-action] ")) return null;
  const nl = s.indexOf("\n");
  const head = (nl < 0 ? s : s.slice(0, nl)).slice("[ui-action] ".length);
  const rest = nl < 0 ? "" : s.slice(nl + 1).trim();
  let type = "";
  try {
    const a = JSON.parse(head);
    type = typeof a?.type === "string" ? a.type : "";
  } catch {
    /* 不是合法 JSON：照样只显示说明 */
  }
  return { type, text: rest };
}

/**
 * 侧栏一行的预览：出错的回复只显示"失败：余额不足"这类简短状态，不显示长串 JSON；
 * 界面操作只显示附带的说明。完整内容在对话里。
 */
export function previewText(raw) {
  const s = String(raw || "");
  if (s.startsWith("⚠️")) {
    const body = s.replace(/^⚠️\s*/, "");
    const e = classifyError(body);
    if (e.kind !== "unfinished" || e.raw) return t("firstUse.errors.short", { what: t(`firstUse.errors.kind.${e.kind}`) });
    return body.replace(/\s+/g, " ").slice(0, 120);
  }
  const ua = uiActionOf(s);
  if (ua) return (ua.text || t("firstUse.errors.uiAction")).replace(/\s+/g, " ");
  return s.replace(/\s+/g, " ");
}
