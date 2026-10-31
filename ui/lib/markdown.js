// 助手消息的 Markdown 子集 → 纯数据 AST（不产出 HTML 字符串）。
// 渲染层用 h() 把 AST 变成节点，文本永远是文本节点，所以不需要另做 HTML 清洗；
// 唯一会进入属性的是链接地址，只放行 http(s): 与 mailto:（safeHref）。
// 支持：段落（软换行保留）、# 标题、``` 代码块（流式中未闭合也按代码块显示）、- / 1. 列表（可嵌套）、
// > 引用、GFM 表格、分隔线；行内：`code`、**粗**、*斜*、~~删~~、[文字](链接)、<链接>、裸链接、\ 转义。

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?/;
const LIST = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

export function safeHref(url) {
  const u = String(url ?? "").trim().replace(/^<|>$/g, "");
  if (!u || /[\s\u0000-\u001f\u007f]/.test(u)) return null;
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : null;
}

function startsBlock(line, next) {
  return FENCE.test(line) || (HEADING.test(line) && /^ {0,3}#{1,6}(\s|$)/.test(line)) || HR.test(line) || QUOTE.test(line) || LIST.test(line) || isTableStart(line, next);
}

function isTableStart(line, next) {
  return line.includes("|") && next !== undefined && TABLE_SEP.test(next) && next.includes("-");
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

export function parseMarkdown(src) {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  return parseLines(lines, 0);
}

function parseLines(lines, depth) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1];
      const body = [];
      i++;
      let open = true;
      while (i < lines.length) {
        const l = lines[i];
        if (new RegExp(`^ {0,3}${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`).test(l)) {
          open = false;
          i++;
          break;
        }
        body.push(l);
        i++;
      }
      out.push({ t: "code", lang: fence[2] || "", text: body.join("\n"), open });
      continue;
    }
    const hd = HEADING.exec(line);
    if (hd && /^ {0,3}#{1,6}(\s|$)/.test(line)) {
      out.push({ t: "h", level: hd[1].length, c: parseInline(hd[2] || "") });
      i++;
      continue;
    }
    if (HR.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }
    if (isTableStart(line, lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        const cells = splitRow(lines[i]);
        rows.push(head.map((_, k) => parseInline(cells[k] ?? "")));
        i++;
      }
      out.push({ t: "table", head: head.map((c) => parseInline(c)), align: head.map((_, k) => align[k] || ""), rows });
      continue;
    }
    if (QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && lines[i].trim() && QUOTE.test(lines[i])) {
        inner.push(lines[i].replace(QUOTE, ""));
        i++;
      }
      out.push({ t: "quote", c: depth < 6 ? parseLines(inner, depth + 1) : [{ t: "p", c: [inner.join("\n")] }] });
      continue;
    }
    const li = LIST.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const indent = li[1].length;
      const items = [];
      let cur = null;
      while (i < lines.length) {
        const l = lines[i];
        const m = LIST.exec(l);
        if (m && m[1].length <= indent + 1 && /\d/.test(m[2]) === ordered) {
          cur = { first: [m[3]], sub: [] };
          items.push(cur);
          i++;
          continue;
        }
        if (!l.trim()) {
          // 列表项之间的空行：后面还是同一列表才继续
          const n = lines[i + 1];
          const nm = n !== undefined ? LIST.exec(n) : null;
          if ((nm && nm[1].length <= indent + 1 && /\d/.test(nm[2]) === ordered) || (n !== undefined && /^ {2,}\S/.test(n))) {
            i++;
            continue;
          }
          break;
        }
        if (/^ {2,}/.test(l) && (LIST.test(l) || cur.sub.length)) {
          cur.sub.push(l.replace(new RegExp(`^ {0,${indent + 4}}`), ""));
          i++;
          continue;
        }
        if (m || startsBlock(l, lines[i + 1])) break;
        // 懒续行
        if (cur.sub.length) cur.sub.push(l.trim());
        else cur.first.push(l.trim());
        i++;
      }
      out.push({
        t: ordered ? "ol" : "ul",
        start: ordered ? parseInt(li[2], 10) : undefined,
        items: items.map((it) => ({ c: parseInline(it.first.join("\n")), sub: it.sub.length && depth < 6 ? parseLines(it.sub, depth + 1) : [] })),
      });
      continue;
    }
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) {
      para.push(lines[i]);
      i++;
    }
    out.push({ t: "p", c: parseInline(para.map((l) => l.replace(/^ {0,3}/, "")).join("\n")) });
  }
  return out;
}

const PUNCT = /[!-/:-@[-`{-~]/;
// 中文标点不算链接的一部分（匹配的是消息正文，不是界面文案）
const TRAIL = /[.,;:!?。，、；：！？'"”’）】》]+$/; // i18n-ignore

function bareUrl(s, i) {
  const m = /^https?:\/\/[^\s<>"'`，。；、（）【】《》“”]+/i.exec(s.slice(i)); // i18n-ignore
  if (!m) return null;
  let url = m[0].replace(TRAIL, "");
  // 末尾 ) 只在括号成对时保留
  while (url.endsWith(")") && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) url = url.slice(0, -1);
  return url.length > 8 ? url : null;
}

function findClose(s, from, mark) {
  for (let j = from; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "`") {
      const run = /^`+/.exec(s.slice(j))[0];
      const end = s.indexOf(run, j + run.length);
      if (end > -1) j = end + run.length - 1;
      continue;
    }
    if (s.startsWith(mark, j)) {
      if (mark.length === 1 && s[j + 1] === mark) {
        j++;
        continue;
      }
      if (j > from && !/\s/.test(s[j - 1])) return j;
    }
  }
  return -1;
}

function matchLink(s, i) {
  let depth = 0;
  let j = i;
  for (; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "[") depth++;
    else if (s[j] === "]" && --depth === 0) break;
    else if (s[j] === "\n" && s[j + 1] === "\n") return null;
  }
  if (j >= s.length || s[j + 1] !== "(") return null;
  let k = j + 2;
  let paren = 0;
  for (; k < s.length; k++) {
    if (s[k] === "(") paren++;
    else if (s[k] === ")") {
      if (paren === 0) break;
      paren--;
    } else if (s[k] === "\n") return null;
  }
  if (k >= s.length) return null;
  const inner = s.slice(j + 2, k).trim();
  const url = inner.replace(/\s+("[^"]*"|'[^']*')$/, "");
  return { text: s.slice(i + 1, j), url, end: k + 1 };
}

export function parseInline(src) {
  const s = String(src ?? "");
  const out = [];
  let text = "";
  const flush = () => {
    if (text) out.push(text);
    text = "";
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length && PUNCT.test(s[i + 1])) {
      text += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      out.push({ t: "br" });
      i++;
      continue;
    }
    if (ch === "`") {
      const run = /^`+/.exec(s.slice(i))[0];
      const end = s.indexOf(run, i + run.length);
      if (end > -1 && s[end + run.length] !== "`") {
        flush();
        let code = s.slice(i + run.length, end).replace(/\n/g, " ");
        if (/^ .*[^ ].* $/.test(code)) code = code.slice(1, -1);
        out.push({ t: "code", text: code });
        i = end + run.length;
        continue;
      }
      text += run;
      i += run.length;
      continue;
    }
    if (ch === "[") {
      const m = matchLink(s, i);
      if (m) {
        flush();
        const href = safeHref(m.url);
        if (href) out.push({ t: "a", href, c: parseInline(m.text) });
        else out.push(...parseInline(m.text));
        i = m.end;
        continue;
      }
    }
    if (ch === "<") {
      const m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(s.slice(i));
      if (m) {
        flush();
        const href = safeHref(m[1]);
        if (href) out.push({ t: "a", href, c: [m[1]] });
        else text += m[0];
        i += m[0].length;
        continue;
      }
    }
    if ((ch === "h" || ch === "H") && (i === 0 || !/[A-Za-z0-9/]/.test(s[i - 1]))) {
      const url = bareUrl(s, i);
      if (url) {
        flush();
        out.push({ t: "a", href: url, c: [url] });
        i += url.length;
        continue;
      }
    }
    if (ch === "*" || ch === "_" || ch === "~") {
      const two = s.startsWith(ch + ch, i);
      if (ch === "~" && !two) {
        text += ch;
        i++;
        continue;
      }
      // 下划线只在词边界起止，避免 snake_case 被当成斜体
      if (ch === "_" && i > 0 && /[\p{L}\p{N}]/u.test(s[i - 1])) {
        text += ch;
        i++;
        continue;
      }
      const mark = two ? ch + ch : ch;
      const from = i + mark.length;
      if (from < s.length && !/\s/.test(s[from])) {
        const end = findClose(s, from, mark);
        if (end > -1 && !(ch === "_" && /[\p{L}\p{N}]/u.test(s[end + mark.length] || ""))) {
          flush();
          const kind = ch === "~" ? "s" : two ? "b" : "i";
          out.push({ t: kind, c: parseInline(s.slice(from, end)) });
          i = end + mark.length;
          continue;
        }
      }
      text += mark;
      i += mark.length;
      continue;
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

/** 用户消息：原样显示，只把链接变成可点的 */
export function linkify(src) {
  const s = String(src ?? "");
  const out = [];
  let text = "";
  let i = 0;
  while (i < s.length) {
    if ((s[i] === "h" || s[i] === "H") && (i === 0 || !/[A-Za-z0-9/]/.test(s[i - 1]))) {
      const url = bareUrl(s, i);
      if (url) {
        if (text) out.push(text);
        text = "";
        out.push({ t: "a", href: url, c: [url] });
        i += url.length;
        continue;
      }
    }
    text += s[i];
    i++;
  }
  if (text) out.push(text);
  return out;
}
