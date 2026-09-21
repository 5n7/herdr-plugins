import { describe, expect, test } from "bun:test";
import { memoryFs } from "../../../packages/herdr-runtime/src/memory-fs";
import { type PaneTabsDeps, readPaneTab } from "../../../packages/herdr-runtime/src/pane-tabs";
import type { HerdrRpc, JsonRpcResponse } from "../../../packages/herdr-runtime/src/rpc";
import { createEvenInvocation, evenTab } from "./even";

function rpc(script: Array<(method: string, params: unknown) => JsonRpcResponse>): HerdrRpc {
  let i = 0;
  return {
    call(method, params) {
      const step = script[i];
      i += 1;
      if (!step) {
        return Promise.resolve({ error: { code: "unexpected" } });
      }
      return Promise.resolve(step(method, params));
    },
  };
}

const tree = {
  type: "split",
  direction: "right",
  ratio: 0.6,
  first: { type: "pane" },
  second: { type: "pane" },
};

describe("evenTab", () => {
  test("returns when the layout is gone", async () => {
    const d: PaneTabsDeps = {
      fs: memoryFs(),
      rpc: rpc([() => ({ error: { code: "layout_not_found" } })]),
      stateDir: "/state",
      socketKey: "s",
      log: () => undefined,
      pid: 1,
    };
    await evenTab(d, "tab");
  });

  test("seeds live panes on the first successful export", async () => {
    const d: PaneTabsDeps = {
      fs: memoryFs(),
      rpc: rpc([
        () => ({ result: { layout: { root: tree } } }),
        () => ({ result: { type: "pane_list", panes: [{ pane_id: "p1", tab_id: "t1" }] } }),
        (method, params) => {
          expect(method).toBe("layout.set_split_ratio");
          expect(params).toEqual({ tab_id: "tab", path: [], ratio: 0.5 });
          return { result: { type: "layout_split_ratio_set" } };
        },
        () => ({ result: { layout: { root: { type: "pane" } } } }),
      ]),
      stateDir: "/state",
      socketKey: "s",
      log: () => undefined,
      pid: 1,
    };
    await evenTab(d, "tab");
    expect(await readPaneTab(d, "p1")).toBe("t1");
  });

  test("equalizes a seeded invocation without listing panes", async () => {
    const methods: string[] = [];
    const d: PaneTabsDeps = {
      fs: memoryFs(),
      rpc: rpc([
        (method) => {
          methods.push(method);
          return { result: { layout: { root: tree } } };
        },
        (method, params) => {
          methods.push(method);
          expect(params).toEqual({ tab_id: "tab", path: [], ratio: 0.5 });
          return { result: { type: "layout_split_ratio_set" } };
        },
        (method) => {
          methods.push(method);
          return { result: { layout: { root: { type: "pane" } } } };
        },
      ]),
      stateDir: "/state",
      socketKey: "s",
      log: () => undefined,
      pid: 1,
    };

    await createEvenInvocation(d, true)("tab");

    expect(methods).toEqual(["layout.export", "layout.set_split_ratio", "layout.export"]);
  });

  test("seeds live panes once across concurrent tabs", async () => {
    let paneListCalls = 0;
    const d: PaneTabsDeps = {
      fs: memoryFs(),
      rpc: {
        async call(method) {
          if (method === "layout.export") {
            return { result: { layout: { root: { type: "pane" } } } };
          }
          if (method === "pane.list") {
            paneListCalls += 1;
            return { result: { type: "pane_list", panes: [] } };
          }
          return { error: { code: "unexpected" } };
        },
      },
      stateDir: "/state",
      socketKey: "s",
      log: () => undefined,
      pid: 1,
    };
    const run = createEvenInvocation(d);
    await Promise.all([run("first"), run("second")]);
    expect(paneListCalls).toBe(1);
  });

  test("shares a seed failure with current waiters and retries for a later tab", async () => {
    let paneListCalls = 0;
    let resolveFirstSeed: (response: JsonRpcResponse) => void = () => undefined;
    let markSeedStarted: () => void = () => undefined;
    const firstSeed = new Promise<JsonRpcResponse>((resolve) => {
      resolveFirstSeed = resolve;
    });
    const seedStarted = new Promise<void>((resolve) => {
      markSeedStarted = resolve;
    });
    const d: PaneTabsDeps = {
      fs: memoryFs(),
      rpc: {
        async call(method) {
          if (method === "layout.export") {
            return { result: { layout: { root: { type: "pane" } } } };
          }
          if (method === "pane.list") {
            paneListCalls += 1;
            if (paneListCalls === 1) {
              markSeedStarted();
              return firstSeed;
            }
            return { result: { type: "pane_list", panes: [] } };
          }
          return { error: { code: "unexpected" } };
        },
      },
      stateDir: "/state",
      socketKey: "s",
      log: () => undefined,
      pid: 1,
    };
    const run = createEvenInvocation(d);
    const first = run("first");
    const second = run("second");
    await seedStarted;
    await Promise.resolve();
    resolveFirstSeed({ error: { code: "temporary" } });

    const failures = await Promise.allSettled([first, second]);
    expect(failures[0]?.status).toBe("rejected");
    expect(failures[1]?.status).toBe("rejected");
    if (failures[0]?.status === "rejected" && failures[1]?.status === "rejected") {
      expect(failures[0].reason).toBe(failures[1].reason);
    }
    expect(paneListCalls).toBe(1);

    await run("later");
    expect(paneListCalls).toBe(2);
  });
});
