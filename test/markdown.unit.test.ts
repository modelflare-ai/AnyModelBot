/**
 * 前端 Markdown 子集：解析为纯数据 AST（渲染层用 h()，文本永远是文本节点）。
 * 这里锁住结构，并确认任何输入都不会把可执行的东西带进属性。
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error 前端模块是无类型的原生 ES 模块
import { parseMarkdown, parseInline, safeHref, linkify } from "../ui/lib/markdown.js";

/** 收集 AST 里所有链接地址 */
function hrefs(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(hrefs);
  if (node && typeof node === "object") {
    const n = node as Record<string, unknown>;
    return [...(n.t === "a" ? [String(n.href)] : []), ...Object.values(n).flatMap(hrefs)];
  }
  return [];
}

describe("Markdown 解析", () => {
  it("段落、软换行、标题、分隔线", () => {
    expect(parseMarkdown("你好\n世界\n\n# 标题\n---")).toEqual([
      { t: "p", c: ["你好", { t: "br" }, "世界"] },
      { t: "h", level: 1, c: ["标题"] },
      { t: "hr" },
    ]);
  });
  it("代码块：语言、内容原样；流式中未闭合也算代码块", () => {
    expect(parseMarkdown("```js\nconst a = '<b>';\n```")).toEqual([{ t: "code", lang: "js", text: "const a = '<b>';", open: false }]);
    expect(parseMarkdown("看：\n```py\nprint(1)")).toEqual([
      { t: "p", c: ["看："] },
      { t: "code", lang: "py", text: "print(1)", open: true },
    ]);
  });
  it("列表（有序起始号、嵌套）与引用", () => {
    const [ol, ul, q] = parseMarkdown("3. 甲\n4. 乙\n\n- 一\n  - 一点一\n- 二\n\n> 引用\n> 第二行");
    expect(ol).toMatchObject({ t: "ol", start: 3, items: [{ c: ["甲"] }, { c: ["乙"] }] });
    expect(ul).toMatchObject({ t: "ul", items: [{ c: ["一"], sub: [{ t: "ul", items: [{ c: ["一点一"] }] }] }, { c: ["二"] }] });
    expect(q).toEqual({ t: "quote", c: [{ t: "p", c: ["引用", { t: "br" }, "第二行"] }] });
  });
  it("GFM 表格：表头、对齐、转义的竖线", () => {
    const [t] = parseMarkdown("| 名称 | 数量 |\n|:--|--:|\n| a\\|b | 2 |");
    expect(t).toEqual({ t: "table", head: [["名称"], ["数量"]], align: ["left", "right"], rows: [[["a|b"], ["2"]]] });
  });
  it("行内：代码、粗体、斜体、删除线、snake_case 不变斜体、转义", () => {
    expect(parseInline("用 `a*b*c` 和 **粗** *斜* ~~删~~ my_var_name \\*星\\*")).toEqual([
      "用 ",
      { t: "code", text: "a*b*c" },
      " 和 ",
      { t: "b", c: ["粗"] },
      " ",
      { t: "i", c: ["斜"] },
      " ",
      { t: "s", c: ["删"] },
      " my_var_name *星*",
    ]);
  });
  it("链接：Markdown 链接、尖括号、裸链接（去掉句末标点）", () => {
    expect(parseInline("见 [文档](https://docs.modelflare.dev/a_(b)) 或 <https://x.dev> 或 https://modelflare.dev/v1。")).toEqual([
      "见 ",
      { t: "a", href: "https://docs.modelflare.dev/a_(b)", c: ["文档"] },
      " 或 ",
      { t: "a", href: "https://x.dev", c: ["https://x.dev"] },
      " 或 ",
      { t: "a", href: "https://modelflare.dev/v1", c: ["https://modelflare.dev/v1"] },
      "。",
    ]);
  });
});

describe("Markdown 安全", () => {
  it("只放行 http(s) 与 mailto", () => {
    expect(safeHref("https://a.b")).toBe("https://a.b");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:text/html,<script>", "vbscript:x", "/relative", "//evil.example", "https://a.b/\u0000x", "java\nscript:x"]) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });
  it("HTML 与脚本只会是文本；危险链接退化为文字", () => {
    const ast = parseMarkdown(
      [
        "<script>alert(1)</script>",
        "<img src=x onerror=alert(1)>",
        "[点我](javascript:alert(1)) [又一个](  JAVASCRIPT:alert(1) ) [数据](data:text/html;base64,PHNjcmlwdD4=)",
        "<javascript:alert(1)>",
        "| a |\n|---|\n| [x](javascript:void(0)) |",
        "- [y](vbscript:msgbox)",
      ].join("\n\n"),
    );
    expect(hrefs(ast)).toEqual([]);
    const text = JSON.stringify(ast);
    expect(text).toContain("<script>alert(1)</script>");
    expect(text).toContain("点我");
    expect(ast.every((b: any) => ["p", "table", "ul"].includes(b.t))).toBe(true);
  });
  it("用户消息只做链接识别", () => {
    expect(linkify("**不是粗体** https://modelflare.dev，<b>")).toEqual(["**不是粗体** ", { t: "a", href: "https://modelflare.dev", c: ["https://modelflare.dev"] }, "，<b>"]);
  });
});
