import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { checkStatic } from "../src/botkit/check.js";
// @ts-expect-error Bot UI uses native JavaScript modules.
import { chartsFrom, chartScale, lineSegments } from "../bots/us-stock-research/ui/chart-data.js";
// @ts-expect-error Bot UI uses native JavaScript modules.
import { parseBlocks } from "../bots/us-stock-research/ui/md.js";
// @ts-expect-error Bot UI uses native JavaScript modules.
import { dragPosition, fitCanvas } from "../bots/printfilm/ui/canvas-layout.js";

const root = path.join(import.meta.dirname, "..");
const languages = ["zh-CN", "en", "ja", "ko", "ru", "es", "pt"];

describe("Bot workspaces", () => {
  it.each(["printfilm", "us-stock-research", "company-research", "ppt-master"])("%s keeps its sandbox and localization contracts", (id) => {
    expect(checkStatic(path.join(root, "bots", id)).issues).toEqual([]);
  });
  it.each(["printfilm", "us-stock-research"])("%s has the same UI keys and parameters in every language", (id) => {
    const dict = (lang: string) => JSON.parse(fs.readFileSync(path.join(root, "bots", id, "ui/locales", `${lang}.json`), "utf8")) as Record<string, string>;
    const en = dict("en");
    for (const lang of languages) {
      const translated = dict(lang);
      expect(Object.keys(translated).sort(), lang).toEqual(Object.keys(en).sort());
      for (const [key, value] of Object.entries(en)) expect((translated[key].match(/\{\w+\}/g) || []).sort(), `${lang}:${key}`).toEqual((value.match(/\{\w+\}/g) || []).sort());
    }
  });
});

describe("research charts", () => {
  it.each(languages)("retains the real sample data and unit note in %s", (lang) => {
    const sample = JSON.parse(fs.readFileSync(path.join(root, "bots/us-stock-research", `sample.${lang}.json`), "utf8"));
    const data = chartsFrom(parseBlocks(sample.runs[0].preview), lang);
    expect(data.cats).toHaveLength(5);
    expect(data.bars).toHaveLength(2);
    expect(data.lines).toHaveLength(1);
    expect(data.unitNote).toBeTruthy();
    // Chinese uses hundred-million USD, Portuguese uses million USD; the others use billion USD.
    expect(data.bars[0].cells[0].value).toBeCloseTo(lang === "zh-CN" ? 3658.17 : lang === "pt" ? 365817 : 365.817);
    expect(data.lines[0].cells.at(-1).value).toBeCloseTo(46.91);
    expect(new Set([...data.bars, ...data.lines].map((s: any) => s.color)).size).toBe(3);
  });
  it("keeps losses visible below zero, including all-negative and zero-only periods", () => {
    for (const values of [[-50, 120, -20], [-50, -20], [0, 0]]) {
      const domain = chartScale(values, true);
      expect(domain.lo).toBeLessThanOrEqual(Math.min(0, ...values));
      expect(domain.hi).toBeGreaterThanOrEqual(Math.max(0, ...values));
      expect(domain.hi).toBeGreaterThan(domain.lo);
      expect(domain.ticks).toContain(0);
    }
    const data = chartsFrom([{ type: "table", head: ["Year", "Profit"], rows: [["2024", "(1,200)"], ["2025", "-400"]] }], "en");
    expect(data.bars[0].cells[0]).toMatchObject({ value: -1200, text: "−1,200" });
  });
  it("breaks lines at missing observations and preserves their original time positions", () => {
    const cells = [{ value: 10 }, { value: 12 }, null, { value: 18 }, { value: 20 }];
    expect(lineSegments(cells, (cell: any, index: number) => [index, cell.value])).toEqual([[[0, 10], [1, 12]], [[3, 18], [4, 20]]]);
    expect(lineSegments([null, { value: 0 }, null], (c: any, i: number) => [i, c.value])).toEqual([[[1, 0]]]);
    expect(lineSegments([null, null], () => null)).toEqual([]);
  });
  it("keeps rate charts readable for constant and fractional observations", () => {
    for (const values of [[46.91, 46.91], [0.001, 0.002], [-5, -2]]) {
      const domain = chartScale(values);
      expect(domain.lo).toBeLessThanOrEqual(Math.min(...values));
      expect(domain.hi).toBeGreaterThanOrEqual(Math.max(...values));
      expect(domain.ticks.length).toBeLessThanOrEqual(8);
      expect(domain.ticks.every(Number.isFinite)).toBe(true);
    }
  });
});

describe("canvas zoom", () => {
  it("fits the full canvas in panel and expanded views", () => {
    for (const [width, height] of [[350, 450], [600, 500], [1200, 650]]) {
      const scale = fitCanvas(width, height);
      expect(1400 * scale).toBeLessThanOrEqual(width);
      expect(900 * scale).toBeLessThanOrEqual(height);
    }
  });
  it("saves world coordinates while dragging at different zoom levels and clamps the edges", () => {
    expect(dragPosition({ x: 100, y: 80 }, 20, -10, 0.5)).toEqual({ x: 140, y: 60 });
    expect(dragPosition({ x: 100, y: 80 }, 40, -20, 1)).toEqual({ x: 140, y: 60 });
    expect(dragPosition({ x: 1190, y: 10 }, 100, -100, 0.25)).toEqual({ x: 1200, y: 0 });
  });
});
