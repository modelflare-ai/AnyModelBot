import { describe, expect, it } from "vitest";
import { fmtStars } from "../src/lib/stars";

describe("fmtStars", () => {
  it.each([
    [0, "0"], [141, "141"], [999, "999"],
    [1000, "1k"], [1234, "1.2k"], [9950, "9.9k"], [9999, "10k"],
    [12345, "12k"], [128600, "129k"],
  ])("%i → %s", (n, text) => expect(fmtStars(n)).toBe(text));
});
