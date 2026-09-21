import { interpretResponse, type JsonRpcResponse } from "../../../packages/herdr-runtime/src/rpc";

export type LayoutDirection = "right" | "down";

export type LayoutPane = { type: "pane" };

export type LayoutSplit = {
  type: "split";
  direction: LayoutDirection;
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
};

export type LayoutNode = LayoutPane | LayoutSplit;

export type PendingSplit = {
  path: boolean[];
  want: number;
};

export type ExportOutcome =
  | { kind: "gone" }
  | { kind: "fail"; code: string }
  | { kind: "ok"; pending: PendingSplit[] };

export const RATIO_MIN = 0.1;
export const RATIO_MAX = 0.9;
export const RATIO_EPS = 0.002;

type AxisUnitCounts = Record<LayoutDirection, number>;

export function clampRatio(value: number): number {
  if (value < RATIO_MIN) {
    return RATIO_MIN;
  }
  if (value > RATIO_MAX) {
    return RATIO_MAX;
  }
  return value;
}

function countAxisUnits(
  node: LayoutNode,
  counts: WeakMap<LayoutNode, AxisUnitCounts>,
): AxisUnitCounts {
  const cached = counts.get(node);
  if (cached) {
    return cached;
  }

  if (node.type === "pane") {
    const paneCounts = { down: 1, right: 1 };
    counts.set(node, paneCounts);
    return paneCounts;
  }

  const first = countAxisUnits(node.first, counts);
  const second = countAxisUnits(node.second, counts);
  const splitCounts = {
    down: node.direction === "down" ? first.down + second.down : Math.max(first.down, second.down),
    right:
      node.direction === "right" ? first.right + second.right : Math.max(first.right, second.right),
  };
  counts.set(node, splitCounts);
  return splitCounts;
}

export function axisUnits(node: LayoutNode, axis: LayoutDirection): number {
  return countAxisUnits(node, new WeakMap())[axis];
}

export function parseLayoutNode(value: unknown): LayoutNode | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const node = value as {
    type?: unknown;
    direction?: unknown;
    ratio?: unknown;
    first?: unknown;
    second?: unknown;
  };
  if (node.type === "pane") {
    return { type: "pane" };
  }
  if (
    node.type !== "split" ||
    (node.direction !== "right" && node.direction !== "down") ||
    typeof node.ratio !== "number" ||
    !Number.isFinite(node.ratio)
  ) {
    return null;
  }
  const first = parseLayoutNode(node.first);
  const second = parseLayoutNode(node.second);
  if (!first || !second) {
    return null;
  }
  return { type: "split", direction: node.direction, ratio: node.ratio, first, second };
}

function collectPendingSplits(
  node: LayoutNode,
  path: boolean[],
  counts: WeakMap<LayoutNode, AxisUnitCounts>,
  pending: PendingSplit[],
): void {
  if (node.type === "pane") {
    return;
  }

  const first = countAxisUnits(node.first, counts);
  const second = countAxisUnits(node.second, counts);
  const want = clampRatio(first[node.direction] / (first[node.direction] + second[node.direction]));
  if (Math.abs(want - node.ratio) > RATIO_EPS) {
    pending.push({ path: [...path], want });
  }

  path.push(false);
  collectPendingSplits(node.first, path, counts, pending);
  path.pop();

  path.push(true);
  collectPendingSplits(node.second, path, counts, pending);
  path.pop();
}

export function pendingSplits(node: LayoutNode): PendingSplit[] {
  const counts = new WeakMap<LayoutNode, AxisUnitCounts>();
  countAxisUnits(node, counts);
  const pending: PendingSplit[] = [];
  collectPendingSplits(node, [], counts, pending);
  return pending;
}

export function interpretExport(response: JsonRpcResponse): ExportOutcome {
  const outcome = interpretResponse(
    response,
    (rpc) => {
      const root = (rpc.result as { layout?: { root?: unknown } } | undefined)?.layout?.root;
      const node = parseLayoutNode(root);
      return node ? pendingSplits(node) : undefined;
    },
    "layout_not_found",
  );
  if (outcome.kind === "missing") {
    return { kind: "gone" };
  }
  return outcome.kind === "ok"
    ? { kind: "ok", pending: outcome.value }
    : { kind: "fail", code: outcome.code };
}
