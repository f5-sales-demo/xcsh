import { describe, expect, it } from "bun:test";
import { medianByStage, parseAttrLines } from "./ttft-attr";

describe("parseAttrLines", () => {
  it("keeps the FIRST occurrence of each stage and ignores duplicates + noise", () => {
    const out = parseAttrLines([
      "unrelated log",
      "[ttft-attr] ttft.normalize-tools 12.5",
      "[ttft-attr] ttft.stream-fn 3",
      "[ttft-attr] ttft.normalize-tools 99",   // later dup — ignored
      "garbage [ttft-attr] malformed",
    ]);
    expect(out).toEqual({ "ttft.normalize-tools": 12.5, "ttft.stream-fn": 3 });
  });

  it("returns {} for no matches", () => {
    expect(parseAttrLines(["nothing here"])).toEqual({});
  });
});

describe("medianByStage", () => {
  it("medians per stage across runs (odd + even)", () => {
    const out = medianByStage([
      { a: 10, b: 4 },
      { a: 20, b: 8 },
      { a: 30 },              // b missing this run
    ]);
    expect(out.a).toBe(20);   // median(10,20,30)
    expect(out.b).toBe(6);    // median(4,8)
  });

  it("returns {} for empty input", () => {
    expect(medianByStage([])).toEqual({});
  });
});
