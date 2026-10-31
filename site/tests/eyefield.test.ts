// 页脚眼睛田的纯逻辑：排法、采样、目光、眨眼、配色、挑模型名
import { describe, expect, it } from "vitest";
import { aim, blinkLid, blinkSpan, cellSize, easeOutBack, EYE_TOKENS, hexToRgb, lens, mixHex, pickColor, pickModels, PLATE_TOKENS, rng, sampleCells, wordLines } from "../src/lib/eyefield";

describe("wordLines", () => {
  it("扁的画布（宽屏 7.4:1）排一行，接近方形（手机 1.3:1）排三行", () => {
    expect(wordLines(1200, 194)).toEqual(["AnyModelBot"]);
    expect(wordLines(343, 264)).toEqual(["Any", "Model", "Bot"]);
  });
});

describe("cellSize", () => {
  it("按字高分格并限幅", () => {
    expect(cellSize(120, 8)).toBe(15);
    expect(cellSize(40, 8)).toBe(9);    // 太小看不出眼睛
    expect(cellSize(400, 8)).toBe(20);  // 太大字形粗糙
  });
});

describe("sampleCells", () => {
  it("只取覆盖过半的格子，格子中心落在格内，整体居中", () => {
    // 左半边全实心的 100×40 遮罩，格子 10px → 4 行 × 5 列（左半边）
    const cells = sampleCells(100, 40, 10, (x) => (x < 50 ? 1 : 0));
    expect(cells).toHaveLength(20);
    expect(Math.max(...cells.map((c) => c.x))).toBe(45);
    expect(cells[0]).toMatchObject({ x: 5, y: 5, col: 0, row: 0 });
  });
  it("放不下整格的余量平均分到两边", () => {
    const cells = sampleCells(105, 10, 10, () => 1);
    expect(cells[0].x).toBeCloseTo(7.5);
  });
});

describe("aim", () => {
  it("目光向量的长度不超过 1，方向朝目标", () => {
    const [x, y] = aim(-1000, 0, 420);
    expect(x).toBeCloseTo(-1);
    expect(y).toBeCloseTo(0);
    const [a, b] = aim(30, 40, 420);
    expect(Math.hypot(a, b)).toBeLessThan(1);
    expect(a / b).toBeCloseTo(0.75);
  });
  it("目标就在脸上时朝正前方", () => expect(aim(0.2, 0.2, 420)).toEqual([0, 0]));
});

describe("lens", () => {
  it("指针正中是 1，半径外是 0", () => {
    expect(lens(0, 60)).toBe(1);
    expect(lens(60, 60)).toBe(0);
    expect(lens(30, 60)).toBeCloseTo(0.25);
  });
});

describe("blinkLid", () => {
  it("一次眨眼：两头睁开、中间几乎闭上", () => {
    expect(blinkLid(0)).toBe(1);
    expect(blinkLid(0.5)).toBeCloseTo(0.08);
    expect(blinkLid(1.5)).toBe(1);
  });
  it("连眨两下时，第二下在 1.25–2.25", () => {
    expect(blinkLid(1.75, true)).toBeCloseTo(0.08);
    expect(blinkSpan(true)).toBe(2.25);
    expect(blinkSpan(false)).toBe(1);
  });
});

describe("easeOutBack", () => {
  it("从 0 到 1，中途略超过 1（弹出来）", () => {
    expect(easeOutBack(0)).toBe(0);
    expect(easeOutBack(1)).toBe(1);
    expect(easeOutBack(0.7)).toBeGreaterThan(1);
  });
});

describe("pickColor", () => {
  it("七成用主色，其余是别的颜色、不会撞回主色", () => {
    const n = EYE_TOKENS.length;
    expect(pickColor(2, n, 0.1, 0.9)).toBe(2);
    for (let k = 0; k < 20; k++) {
      const c = pickColor(2, n, 0.95, k / 20);
      expect(c).not.toBe(2);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(n);
    }
  });
});

describe("pickModels", () => {
  it("每家厂商取第一个，保持顺序，最多 n 个", () => {
    const rows = [
      { model: "a-1", vendor: "A" }, { model: "a-2", vendor: "A" },
      { model: "b-1", vendor: "B" }, { model: "c-1", vendor: "C" },
    ];
    expect(pickModels(rows)).toEqual(["a-1", "b-1", "c-1"]);
    expect(pickModels(rows, 2)).toEqual(["a-1", "b-1"]);
  });
});

describe("rng", () => {
  it("同一个种子排出同样的田", () => {
    const a = rng(7), b = rng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(a()).toBeLessThan(1);
  });
});

describe("浅色的淡彩面罩", () => {
  it("面罩色和眼睛色一一对应同一个角色", () => {
    expect(PLATE_TOKENS).toHaveLength(EYE_TOKENS.length);
    PLATE_TOKENS.forEach((t, i) => expect(t.replace("-glow", "")).toBe(EYE_TOKENS[i].replace("-eye", "")));
  });
  it("hexToRgb 认 #rgb / #rrggbb，别的返回 null", () => {
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb(" #2a9dff ")).toEqual([42, 157, 255]);
    expect(hexToRgb("rgba(0,0,0,.5)")).toBeNull();
  });
  it("mixHex 按比例调进底色；认不出来就返回底色", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#000000");
    expect(mixHex("#2a9dff", "#fafaf7", 0.32)).toBe("#b7dcfa");
    expect(mixHex("oops", "#fafaf7", 0.5)).toBe("#fafaf7");
  });
});
