// Eyes 标记的目光数学（§7.10）：限幅、正左、正中心
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
const { aim, aimFace } = await import("../src/lib/eyes");

const rect = (size: number) => ({ left: 500, top: 500, width: size, height: size });
const c = (size: number) => 500 + size / 2;

describe("aim", () => {
  it("指针在标记正左 300px：look-x ≤ −0.9", () => {
    // 导航 24px、页脚 48px、H1 内联约 70px（360px 的大插画满偏半径是 520px，300px 处约 −0.82，属预期）
    for (const s of [24, 48, 70]) {
      const [x, y] = aim(rect(s), c(s) - 300, c(s));
      expect(x).toBeLessThanOrEqual(-0.9);
      expect(Math.abs(y)).toBeLessThan(1e-9);
    }
  });
  it("指针在标记中心：|x|、|y| < 0.05", () => {
    const [x, y] = aim(rect(48), c(48) + 1, c(48) - 1);
    expect(Math.abs(x)).toBeLessThan(0.05);
    expect(Math.abs(y)).toBeLessThan(0.05);
  });
  it("任意位置 hypot(x, y) ≤ 1", () => {
    for (let i = 0; i < 2000; i++) {
      const s = 16 + Math.random() * 400;
      const [x, y] = aim(rect(s), Math.random() * 3000 - 1000, Math.random() * 3000 - 1000);
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe("aimFace（与 App 的 BotAvatar 相同的衰减）", () => {
  it("远处不看", () => {
    expect(aimFace(rect(72), 4000, 4000)).toEqual([0, 0]);
  });
  it("近处看过去且不越界", () => {
    const [x, y] = aimFace(rect(72), c(72) + 40, c(72));
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThanOrEqual(1);
    expect(y).toBeCloseTo(0, 6);
  });
});
