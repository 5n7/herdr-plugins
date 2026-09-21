import { describe, expect, test } from "bun:test";
import { memoryFs } from "./memory-fs";
import {
  notePaneTab,
  type PaneTabsDeps,
  type PluginEvent,
  pluginEventFromEnv,
  readPaneTab,
  resolveTabs,
  seedLivePaneTabs,
} from "./pane-tabs";
import type { HerdrRpc, JsonRpcResponse } from "./rpc";

function rpc(handlers: Record<string, (params: unknown) => JsonRpcResponse>): HerdrRpc {
  return {
    call(method, params) {
      const handler = handlers[method];
      if (!handler) {
        return Promise.resolve({ error: { code: "unknown_method" } });
      }
      return Promise.resolve(handler(params));
    },
  };
}

function deps(partial?: Partial<PaneTabsDeps> & { rpc?: HerdrRpc }): {
  deps: PaneTabsDeps;
  logs: string[];
} {
  const logs: string[] = [];
  return {
    logs,
    deps: {
      fs: memoryFs(),
      rpc: rpc({}),
      stateDir: "/state",
      socketKey: "abc",
      log: (message) => logs.push(message),
      pid: 42,
      ...partial,
    },
  };
}

function event(partial: Partial<PluginEvent>): PluginEvent {
  return {
    event: "",
    eventJson: {},
    paneId: "",
    tabId: "",
    workspaceId: "",
    ...partial,
  };
}

describe("seedLivePaneTabs", () => {
  test("creates the note directory once and writes independent notes concurrently", async () => {
    const { deps: d } = deps({
      rpc: rpc({
        "pane.list": () => ({
          result: {
            type: "pane_list",
            panes: [
              { pane_id: "p1", tab_id: "t1" },
              { pane_id: "p2", tab_id: "t2" },
            ],
          },
        }),
      }),
    });
    const mkdirp = d.fs.mkdirp.bind(d.fs);
    const writeFile = d.fs.writeFile.bind(d.fs);
    let activeWrites = 0;
    let maxActiveWrites = 0;
    let mkdirpCalls = 0;
    d.fs.mkdirp = async (path) => {
      mkdirpCalls += 1;
      await mkdirp(path);
    };
    d.fs.writeFile = async (path, data) => {
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      await Promise.resolve();
      await writeFile(path, data);
      activeWrites -= 1;
    };

    await seedLivePaneTabs(d);

    expect(mkdirpCalls).toBe(1);
    expect(maxActiveWrites).toBe(2);
  });

  test("fails when pane.list is not a pane_list", async () => {
    const { deps: d } = deps({
      rpc: rpc({
        "pane.list": () => ({ error: { code: "boom" } }),
      }),
    });
    await expect(seedLivePaneTabs(d)).rejects.toThrow("pane.list failed: boom");
  });

  test("rejects a pane_list whose panes field is not an array", async () => {
    const { deps: d } = deps({
      rpc: rpc({
        "pane.list": () => ({ result: { type: "pane_list", panes: null } }),
      }),
    });
    await expect(seedLivePaneTabs(d)).rejects.toThrow("pane.list returned invalid pane data");
  });

  test("rejects malformed pane_list entries", async () => {
    const invalidEntries = [
      null,
      "pane",
      { pane_id: 1, tab_id: "t1" },
      { pane_id: "p1", tab_id: null },
    ];
    for (const entry of invalidEntries) {
      const { deps: d } = deps({
        rpc: rpc({
          "pane.list": () => ({ result: { type: "pane_list", panes: [entry] } }),
        }),
      });
      await expect(seedLivePaneTabs(d)).rejects.toThrow("pane.list returned invalid pane data");
    }
  });
});

describe("pluginEventFromEnv", () => {
  test("reads event metadata and scope identifiers", () => {
    expect(
      pluginEventFromEnv({
        HERDR_PLUGIN_EVENT: "pane.created",
        HERDR_PLUGIN_EVENT_JSON: '{"data":{"source":"test"}}',
        HERDR_PANE_ID: "pane",
        HERDR_TAB_ID: "tab",
        HERDR_WORKSPACE_ID: "workspace",
      }),
    ).toEqual({
      event: "pane.created",
      eventJson: { data: { source: "test" } },
      paneId: "pane",
      tabId: "tab",
      workspaceId: "workspace",
    });
  });

  test("uses an empty object for malformed event JSON", () => {
    expect(pluginEventFromEnv({ HERDR_PLUGIN_EVENT_JSON: "{" }).eventJson).toEqual({});
  });
});

describe("resolveTabs", () => {
  test("resolves startup to unique tab IDs in stable order and writes final pane notes", async () => {
    const { deps: d } = deps({
      rpc: rpc({
        "pane.list": () => ({
          result: {
            type: "pane_list",
            panes: [
              { pane_id: "p1", tab_id: "t1" },
              { pane_id: "p1", tab_id: "t2" },
              { pane_id: "p2", tab_id: "t2" },
              { pane_id: "p3", tab_id: "t3" },
              { pane_id: "", tab_id: "t4" },
              { pane_id: "p4", tab_id: "" },
            ],
          },
        }),
      }),
    });
    expect(await resolveTabs(d, event({ event: "startup" }))).toEqual({
      tabIds: ["t1", "t2", "t3"],
      skipped: false,
    });
    expect(await readPaneTab(d, "p1")).toBe("t2");
    expect(await readPaneTab(d, "p2")).toBe("t2");
    expect(await readPaneTab(d, "p3")).toBe("t3");
    expect(await readPaneTab(d, "p4")).toBeNull();
  });

  test("uses the supplied tab for an action", async () => {
    const { deps: d } = deps();
    expect(await resolveTabs(d, event({ tabId: "t1" }))).toEqual({
      tabIds: ["t1"],
      skipped: false,
    });
  });

  test("uses the active workspace tab when an action has no tab", async () => {
    const { deps: d } = deps({
      rpc: rpc({
        "workspace.get": () => ({ result: { workspace: { active_tab_id: "active" } } }),
      }),
    });
    expect(await resolveTabs(d, event({ workspaceId: "ws" }))).toEqual({
      tabIds: ["active"],
      skipped: false,
    });
  });

  test("skips an unsupported event instead of treating it as an action", async () => {
    const { deps: d, logs } = deps();
    const result = await resolveTabs(d, event({ event: "pane.updated", tabId: "t1" }));
    expect(result).toEqual({ tabIds: [], skipped: true });
    expect(logs).toEqual(["unsupported plugin event pane.updated; skipping"]);
  });

  test("skips pane.closed when no note exists and does not use the workspace tab", async () => {
    const { deps: d, logs } = deps({
      rpc: rpc({
        "workspace.get": () => ({ result: { workspace: { active_tab_id: "active" } } }),
      }),
    });
    const result = await resolveTabs(
      d,
      event({ event: "pane.closed", paneId: "missing", workspaceId: "ws" }),
    );
    expect(result).toEqual({ tabIds: [], skipped: true });
    expect(logs).toEqual(["pane.closed: no tab note for pane missing; skipping"]);
  });

  test("closes against the noted tab and removes the note", async () => {
    const { deps: d } = deps();
    await notePaneTab(d, "p1", "t1");
    const result = await resolveTabs(
      d,
      event({ event: "pane.closed", paneId: "p1", workspaceId: "ws" }),
    );
    expect(result).toEqual({ tabIds: ["t1"], skipped: false });
    expect(await readPaneTab(d, "p1")).toBeNull();
  });

  test("writes the destination note before removing the source pane on move", async () => {
    const order: string[] = [];
    const { deps: d } = deps({
      rpc: rpc({
        "pane.get": () => ({ result: { pane: { tab_id: "dest" } } }),
      }),
    });
    const originalNote = d.fs.writeFile.bind(d.fs);
    const originalRm = d.fs.rm.bind(d.fs);
    d.fs.writeFile = async (path, data) => {
      order.push(`write:${path}:${data}`);
      return originalNote(path, data);
    };
    d.fs.rename = async (from, to) => {
      const data = await d.fs.readFile(from);
      order.push(`rename:${to}:${data ?? ""}`);
      await originalRm(from);
      if (data !== null) {
        await originalNote(to, data);
      }
    };
    d.fs.rm = async (path) => {
      order.push(`rm:${path}`);
      return originalRm(path);
    };
    await notePaneTab(d, "old-pane", "src");
    const result = await resolveTabs(
      d,
      event({
        event: "pane.moved",
        paneId: "new-pane",
        eventJson: { data: { previous_tab_id: "src", previous_pane_id: "old-pane" } },
      }),
    );
    expect(result.tabIds).toEqual(["dest", "src"]);
    const destWrite = order.findIndex(
      (step) =>
        step.includes("/panes/abc/") && step.startsWith("rename:") && step.endsWith(":dest"),
    );
    const srcRm = order.findIndex((step) => step.startsWith("rm:") && step.includes("/panes/abc/"));
    expect(destWrite).toBeGreaterThanOrEqual(0);
    expect(srcRm).toBeGreaterThan(destWrite);
    expect(await readPaneTab(d, "new-pane")).toBe("dest");
    expect(await readPaneTab(d, "old-pane")).toBeNull();
  });

  test("keeps a same-id move note instead of deleting it", async () => {
    const { deps: d } = deps({
      rpc: rpc({
        "pane.get": () => ({ result: { pane: { tab_id: "dest" } } }),
      }),
    });
    const result = await resolveTabs(
      d,
      event({
        event: "pane.moved",
        paneId: "p1",
        eventJson: { data: { previous_tab_id: "src", previous_pane_id: "p1" } },
      }),
    );
    expect(result.tabIds).toEqual(["dest", "src"]);
    expect(await readPaneTab(d, "p1")).toBe("dest");
  });
});
