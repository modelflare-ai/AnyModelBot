/**
 * 模型写的 Markdown → 各平台能显示的格式。Discord 基本原样；Slack 有自己的 mrkdwn；Telegram 用 HTML 模式（比 MarkdownV2 好转义）。
 * 只转常见的（标题、粗斜体、删除线、行内代码、代码块、链接、列表）。转错了 Telegram 会拒收，那时改发纯文本（见 telegram.ts）。
 */
import { splitText } from "../../core/types.js";

/** 代码块的开头那行：长语言名也算在内，切段时补的 ``` 不会撑破上限 */
const FENCE_MARGIN = 32;

/**
 * 按段落切长文本，切在代码块中间时收好这一段、下一段重新打开，每段都能单独显示。
 * 同样的文字切法总是一样（出站队列按第几段续发靠这个）。
 */
export function splitMarkdown(text: string, limit: number): string[] {
  const out: string[] = [];
  let open = "";
  for (const chunk of splitText(text, limit - FENCE_MARGIN)) {
    const body = open ? `${open}\n${chunk}` : chunk;
    let fence = open;
    for (const line of chunk.split("\n")) if (/^\s*```/.test(line)) fence = fence ? "" : line.trim().slice(0, FENCE_MARGIN - 8);
    open = fence;
    out.push(open ? `${body}\n\`\`\`` : body);
  }
  return out;
}

/** Markdown 表格在这几个平台上都不显示成表格：放进代码块，至少列是对齐的 */
export function fenceTables(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) inCode = !inCode;
    const starts = !inCode && /^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1] ?? "");
    if (!starts) {
      out.push(line);
      continue;
    }
    out.push("```");
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) out.push(lines[i++]);
    out.push("```");
    i--;
  }
  return out.join("\n");
}

/** 分开代码块和普通文字；没关上的代码块算到结尾 */
function segments(md: string): Array<{ code: boolean; text: string; lang?: string }> {
  const out: Array<{ code: boolean; text: string; lang?: string }> = [];
  const re = /^[ \t]*```([^\n`]*)\n?([\s\S]*?)(?:^[ \t]*```[ \t]*$|$(?![\s\S]))/gm;
  let at = 0;
  for (const m of md.matchAll(re)) {
    if (m.index > at) out.push({ code: false, text: md.slice(at, m.index) });
    out.push({ code: true, text: m[2].replace(/\n$/, ""), lang: m[1].trim() });
    at = m.index + m[0].length;
  }
  if (at < md.length) out.push({ code: false, text: md.slice(at) });
  return out;
}

/** 行内代码先换成占位符（里面的星号不算强调），render 把内容转好，restore 换回来 */
function stashCode(s: string, render: (code: string) => string): { text: string; restore: (s: string) => string } {
  const codes: string[] = [];
  const text = s.replace(/`([^`\n]+)`/g, (_, c: string) => `\u0000${codes.push(render(c)) - 1}\u0000`);
  return { text, restore: (x) => x.replace(/\u0000(\d+)\u0000/g, (_, n: string) => codes[Number(n)]) };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Markdown → Telegram 的 HTML */
export function toTelegramHtml(md: string): string {
  return segments(fenceTables(md))
    .map((seg) => {
      if (seg.code) return `<pre>${escapeHtml(seg.text)}</pre>`;
      const { text, restore } = stashCode(escapeHtml(seg.text), (c) => `<code>${c}</code>`);
      const out = text
        .replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, "<b>$1</b>")
        .replace(/^([ \t]*)[-*+][ \t]+/gm, "$1• ")
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, url: string) => `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`)
        .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<b>$1</b>")
        .replace(/(?<![\w_])__(?=\S)(.+?)(?<=\S)__(?![\w_])/g, "<b>$1</b>")
        .replace(/(?<![\w*])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\w*])/g, "<i>$1</i>")
        .replace(/(?<![\w_])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\w_])/g, "<i>$1</i>")
        .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "<s>$1</s>");
      return restore(out);
    })
    .join("")
    .trim();
}

/** Markdown → Slack 的 mrkdwn */
export function toSlackMrkdwn(md: string): string {
  // 粗体换成占位符，等单星号的斜体转完再换回 *x*，否则会被当成斜体再转一次
  const BOLD = "\u0001";
  return segments(fenceTables(md))
    .map((seg) => {
      if (seg.code) return `\`\`\`\n${seg.text}\n\`\`\``;
      const { text, restore } = stashCode(seg.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), (c) => `\`${c}\``);
      const out = text
        .replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, `${BOLD}$1${BOLD}`)
        .replace(/^([ \t]*)[-*+][ \t]+/gm, "$1• ")
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>")
        .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, `${BOLD}$1${BOLD}`)
        .replace(/(?<![\w_])__(?=\S)(.+?)(?<=\S)__(?![\w_])/g, `${BOLD}$1${BOLD}`)
        .replace(/(?<![\w*])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\w*])/g, "_$1_")
        .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "~$1~")
        .replaceAll(BOLD, "*");
      return restore(out);
    })
    .join("")
    .trim();
}
