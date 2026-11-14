import { describe, expect, it } from "vitest";
// @ts-expect-error UI modules are native JavaScript.
import { addResource, removeResource, emptyResources, fileResource, appFileResource, websiteResource, localFilePath, plainClick, resourcePreviewPath } from "../ui/lib/resource-preview.js";
// @ts-expect-error UI modules are native JavaScript.
import { parseMarkdown } from "../ui/lib/markdown.js";

describe("resource preview navigation", () => {
  it("keeps files in different conversations distinct and reuses an opened item", () => {
    const one = fileResource({ path: "out/report.md" }, "bot:one");
    const two = fileResource({ path: "out/report.md" }, "bot:two");
    let state = addResource(addResource(emptyResources(), one), two);
    expect(state.items).toHaveLength(2);
    state = addResource(state, one);
    expect(state.items).toHaveLength(2);
    expect(state.active).toBe(one.id);
    expect(removeResource(state, one.id)).toEqual({ items: [two], active: two.id });
    expect(removeResource(removeResource(state, one.id), two.id)).toEqual(emptyResources());
    expect(fileResource({ path: "missing.pdf", gone: true }, "bot:one")).toBeNull();
  });

  it("bounds the open list and preserves modified link clicks", () => {
    let state = emptyResources();
    for (let i = 0; i < 20; i++) state = addResource(state, fileResource({ path: `${i}.md` }, "c"));
    expect(state.items).toHaveLength(12);
    expect(state.items[0].path).toBe("8.md");
    expect(plainClick({ button: 0 })).toBe(true);
    for (const event of [{ button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { defaultPrevented: true }]) expect(plainClick(event)).toBe(false);
  });

  it("previews only external HTTP(S) URLs without credentials", () => {
    expect(websiteResource("https://example.com/a", "Docs", "http://localhost:5000")).toMatchObject({ type: "website", name: "Docs", url: "https://example.com/a" });
    for (const value of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "https://u:p@example.com", "/amb/api/status", "http://localhost:5000/amb/api/status"]) {
      expect(websiteResource(value, "", "http://localhost:5000"), value).toBeNull();
    }
  });

  it("keeps Bot workbench files on the app-scoped API", () => {
    const item = appFileResource("app/site/index.html", "bot", true);
    expect(resourcePreviewPath(item)).toBe("/bots/bot/app/preview?path=app%2Fsite%2Findex.html");
    for (const p of ["notes.md", "app/../secret.md", "app/%2e%2e/secret.md"]) expect(appFileResource(p, "bot")).toBeNull();
  });
});

describe("local document links", () => {
  it("enables file links only in a file-capable context, including nested Markdown", () => {
    const source = "# [Report](out/report.md)\n\n> **[Page](sandbox:/work/page.html)**\n\n| File |\n|---|\n| [PDF](file:///work/report.pdf) |";
    expect(JSON.stringify(parseMarkdown(source))).not.toContain('"t":"file"');
    const parsed = JSON.stringify(parseMarkdown(source, true));
    for (const p of ["out/report.md", "/work/page.html", "/work/report.pdf"]) expect(parsed).toContain(p);
    for (const p of ["../secret", "%2e%2e/secret", "javascript:alert(1)", "data:text/html,hi", "//server/file", "file://server/file", "file:///work/%00bad"]) expect(localFilePath(p), p).toBeNull();
    expect(localFilePath("C:\\work\\report.md")).toBe("C:\\work\\report.md");
  });
});
