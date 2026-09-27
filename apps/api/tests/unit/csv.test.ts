import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "../../src/lib/csv";
import { compositeScore } from "../../src/judging/composite";

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('Docs are thin, "mostly"')).toBe('"Docs are thin, ""mostly"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("neutralises spreadsheet formulas in text but not in numbers", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-0.5)).toBe("-0.5");
  });

  it("writes a header row and CRLF line endings", () => {
    expect(toCsv(["a", "b"], [[1, null]])).toBe("a,b\r\n1,\r\n");
  });
});

describe("composite score", () => {
  const criteria = [
    { id: "f", key: "functionality", weight: 2, minScore: 1, maxScore: 5 },
    { id: "q", key: "quality", weight: 1, minScore: 1, maxScore: 5 },
    { id: "x", key: "extra", weight: 1, minScore: 0, maxScore: 10 },
  ];

  it("applies weights on a common 1-5 scale", () => {
    // f=5 (1.0), q=1 (0.0), weights 2:1 → 2/3 of the range → 1 + 4*(2/3)
    const v = compositeScore(new Map([["f", 5], ["q", 1]]), criteria);
    expect(v).toBeCloseTo(1 + 4 * (2 / 3));
  });

  it("rescales criteria with different ranges before weighting", () => {
    expect(compositeScore(new Map([["x", 10]]), criteria)).toBe(5);
    expect(compositeScore(new Map([["x", 0]]), criteria)).toBe(1);
  });

  it("returns null when nothing was scored", () => {
    expect(compositeScore(new Map(), criteria)).toBeNull();
  });
});
