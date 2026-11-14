import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let ui: any;
beforeAll(async () => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, dispatchEvent() {} });
  vi.stubGlobal("document", { documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, removeAttribute() {} }, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  // @ts-expect-error Native browser JavaScript module.
  ui = await import("../ui/components/ui.js");
});
afterAll(() => vi.unstubAllGlobals());

describe("Heroicons operation icons", () => {
  it("renders every public icon with the upstream viewport and accessible button-compatible SVG", () => {
    const source = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../ui/icons/heroicons-source.json"), "utf8"));
    expect(ui.ICONS).toHaveLength(48);
    expect(ui.ICONS).toEqual(Object.keys(source.icons));
    for (const name of ui.ICONS) {
      const svg = ui.Icon({ name });
      expect(svg.type).toBe("svg");
      expect(svg.props).toMatchObject({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "aria-hidden": "true", focusable: "false" });
      const shapes = [svg.props.children].flat(Infinity);
      expect(shapes.length).toBeGreaterThan(0);
      expect(shapes.every((n: any) => ["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"].includes(n.type))).toBe(true);
      expect(source.icons[name].sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(fs.readFileSync(path.join(import.meta.dirname, "../ui/icons/LICENSE"), "utf8")).toContain("Tailwind Labs");
  });

  it.each([["xs", 12], ["sm", 14], ["md", 16], ["lg", 20], ["xl", 24]])("keeps %s and its legacy numeric values on the same CSS size", (size, pixels) => {
    const named = ui.Icon({ name: "chevRight", size });
    for (const value of [pixels, String(pixels)]) {
      const numeric = ui.Icon({ name: "chevRight", size: value });
      expect(numeric.props.width).toBe(named.props.width);
      expect(numeric.props.height).toBe(named.props.height);
      expect(numeric.props.class).toBe(named.props.class);
    }
    expect(named.props.width).toBe(pixels);
    expect(named.props.class).toContain(`ic-${size}`);
  });

  it("preserves the default size and strong/custom classes without accepting arbitrary size classes", () => {
    for (const size of [undefined, 18, "huge"]) {
      const svg = ui.Icon({ name: "up", size, strong: true, class: "send-icon" });
      expect(svg.props.width).toBe(16);
      expect(svg.props.class).toBe("ic ic-md ic-strong send-icon");
    }
  });
});
