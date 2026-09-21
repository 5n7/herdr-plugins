import { describe, expect, test } from "bun:test";
import {
  axisUnits,
  clampRatio,
  interpretExport,
  type LayoutDirection,
  type LayoutNode,
  parseLayoutNode,
  pendingSplits,
  RATIO_MAX,
  RATIO_MIN,
} from "./layout";

function pane(): LayoutNode {
  return { type: "pane" };
}

function split(
  direction: LayoutDirection,
  ratio: number,
  first: LayoutNode,
  second: LayoutNode,
): LayoutNode {
  return { type: "split", direction, ratio, first, second };
}

describe("clampRatio", () => {
  test("keeps interior values", () => {
    expect(clampRatio(0.5)).toBe(0.5);
  });
  test("clamps to herdr bounds", () => {
    expect(clampRatio(0)).toBe(RATIO_MIN);
    expect(clampRatio(1)).toBe(RATIO_MAX);
  });
});

describe("axisUnits", () => {
  test("counts panes on the same axis", () => {
    const tree = split("right", 0.6, pane(), split("right", 0.5, pane(), pane()));
    expect(axisUnits(tree, "right")).toBe(3);
  });
  test("cross-axis splits take the max child", () => {
    const tree = split("right", 0.5, split("down", 0.5, pane(), pane()), pane());
    expect(axisUnits(tree, "right")).toBe(2);
    expect(axisUnits(tree, "down")).toBe(2);
  });
});

describe("pendingSplits", () => {
  test("evens a 2:1:1 column tree at the outer split", () => {
    const tree = split("right", 0.6, pane(), split("right", 0.5, pane(), pane()));
    expect(pendingSplits(tree)).toEqual([{ path: [], want: 1 / 3 }]);
  });
  test("skips splits already within one cell", () => {
    const tree = split("right", 1 / 3, pane(), split("right", 0.5, pane(), pane()));
    expect(pendingSplits(tree)).toEqual([]);
  });
  test("equalizes rows independently of columns", () => {
    const tree = split(
      "right",
      0.5,
      split("down", 0.7, pane(), pane()),
      split("down", 0.7, pane(), pane()),
    );
    expect(pendingSplits(tree)).toEqual([
      { path: [false], want: 0.5 },
      { path: [true], want: 0.5 },
    ]);
  });
  test("returns nested splits in parent-first order", () => {
    const tree = split("right", 0.8, pane(), split("right", 0.8, pane(), pane()));
    expect(pendingSplits(tree)).toEqual([
      { path: [], want: 1 / 3 },
      { path: [true], want: 0.5 },
    ]);
  });
});

describe("interpretExport", () => {
  test("treats layout_not_found as gone", () => {
    expect(interpretExport({ error: { code: "layout_not_found" } })).toEqual({ kind: "gone" });
  });
  test("fails without a root", () => {
    expect(interpretExport({ error: { code: "boom" } })).toEqual({ kind: "fail", code: "boom" });
    expect(interpretExport({})).toEqual({ kind: "fail", code: "transport" });
  });
  test("parses a live tree", () => {
    const response = {
      result: {
        layout: {
          root: {
            type: "split",
            direction: "right",
            ratio: 0.6,
            first: { type: "pane" },
            second: { type: "pane" },
          },
        },
      },
    };
    const outcome = interpretExport(response);
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.pending).toEqual([{ path: [], want: 0.5 }]);
    }
  });
  test("rejects an unparseable root", () => {
    expect(parseLayoutNode({ type: "split" })).toBeNull();
  });
  test("rejects non-finite ratios", () => {
    for (const ratio of [Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
      expect(
        parseLayoutNode({
          type: "split",
          direction: "right",
          ratio,
          first: { type: "pane" },
          second: { type: "pane" },
        }),
      ).toBeNull();
    }
  });
});
