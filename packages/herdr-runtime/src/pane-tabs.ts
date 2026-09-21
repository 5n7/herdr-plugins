import type { PluginFs } from "./fs";
import { hexKey } from "./hex";
import { type HerdrRpc, interpretResponse, type JsonRpcResponse, requireField } from "./rpc";

type PluginEventKind =
  | "action"
  | "pane.created"
  | "pane.moved"
  | "pane.closed"
  | "startup"
  | "unknown";

export type PluginEvent = {
  event: string;
  eventJson: unknown;
  paneId: string;
  tabId: string;
  workspaceId: string;
};

export type PaneTabsDeps = {
  fs: PluginFs;
  rpc: HerdrRpc;
  stateDir: string;
  socketKey: string;
  log: (message: string) => void;
  pid: number;
};

export type PaneListEntry = {
  pane_id: string;
  tab_id: string;
};

export type ResolveTabsResult = {
  tabIds: string[];
  skipped: boolean;
};

function classifyPluginEvent(event: string): PluginEventKind {
  switch (event) {
    case "":
      return "action";
    case "pane.created":
    case "pane.moved":
    case "pane.closed":
    case "startup":
      return event;
    default:
      return "unknown";
  }
}

function eventData(eventJson: unknown): Record<string, unknown> {
  if (typeof eventJson !== "object" || eventJson === null || !("data" in eventJson)) {
    return {};
  }
  const data = (eventJson as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) {
    return {};
  }
  return data as Record<string, unknown>;
}

function paneNoteDir(deps: PaneTabsDeps): string {
  return `${deps.stateDir}/panes/${deps.socketKey}`;
}

function paneNotePath(deps: PaneTabsDeps, paneId: string): string {
  return `${paneNoteDir(deps)}/${hexKey(paneId)}`;
}

async function writePaneNote(deps: PaneTabsDeps, paneId: string, tabId: string): Promise<void> {
  const notePath = paneNotePath(deps, paneId);
  const temporary = `${notePath}.${deps.pid}`;
  await deps.fs.writeFile(temporary, tabId);
  await deps.fs.rename(temporary, notePath);
}

export async function notePaneTab(
  deps: PaneTabsDeps,
  paneId: string,
  tabId: string,
): Promise<void> {
  if (!paneId || !tabId) {
    return;
  }
  await deps.fs.mkdirp(paneNoteDir(deps));
  await writePaneNote(deps, paneId, tabId);
}

export async function readPaneTab(deps: PaneTabsDeps, paneId: string): Promise<string | null> {
  return deps.fs.readFile(paneNotePath(deps, paneId));
}

export async function removePaneNote(deps: PaneTabsDeps, paneId: string): Promise<void> {
  await deps.fs.rm(paneNotePath(deps, paneId));
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function paneTab(deps: PaneTabsDeps, paneId: string): Promise<string | null> {
  const response = await deps.rpc.call("pane.get", { pane_id: paneId });
  const outcome = interpretResponse(
    response,
    (rpc) => {
      const pane = (rpc.result as { pane?: { tab_id?: unknown } } | undefined)?.pane;
      const tabId = pane?.tab_id;
      return typeof tabId === "string" && tabId ? tabId : undefined;
    },
    "pane_not_found",
  );
  return requireField(outcome, `pane.get ${paneId}`);
}

export async function workspaceActiveTab(
  deps: PaneTabsDeps,
  workspaceId: string,
): Promise<string | null> {
  const response = await deps.rpc.call("workspace.get", { workspace_id: workspaceId });
  const outcome = interpretResponse(
    response,
    (rpc) => {
      const tabId = (rpc.result as { workspace?: { active_tab_id?: unknown } } | undefined)
        ?.workspace?.active_tab_id;
      return typeof tabId === "string" && tabId ? tabId : undefined;
    },
    "workspace_not_found",
  );
  return requireField(outcome, "workspace.get");
}

function paneListEntries(response: JsonRpcResponse): PaneListEntry[] | null {
  const type = (response.result as { type?: unknown } | undefined)?.type;
  if (type !== "pane_list") {
    return null;
  }
  const panes = (response.result as { panes?: unknown }).panes;
  if (!Array.isArray(panes)) {
    return null;
  }
  const entries: PaneListEntry[] = [];
  for (const pane of panes) {
    if (typeof pane !== "object" || pane === null || Array.isArray(pane)) {
      return null;
    }
    const { pane_id: paneId, tab_id: tabId } = pane as Record<string, unknown>;
    if (typeof paneId !== "string" || typeof tabId !== "string") {
      return null;
    }
    entries.push({ pane_id: paneId, tab_id: tabId });
  }
  return entries;
}

export async function seedLivePaneTabs(deps: PaneTabsDeps): Promise<string[]> {
  const response = await deps.rpc.call("pane.list", {});
  const typeOutcome = interpretResponse(
    response,
    (rpc) => (rpc.result as { type?: unknown } | undefined)?.type,
  );
  if (typeOutcome.kind !== "ok" || typeOutcome.value !== "pane_list") {
    const code = typeOutcome.kind === "fail" ? typeOutcome.code : "transport";
    throw new Error(`pane.list failed: ${code}`);
  }
  const panes = paneListEntries(response);
  if (panes === null) {
    throw new Error("pane.list returned invalid pane data");
  }
  const notes = new Map<string, string>();
  const tabIds = new Set<string>();
  for (const { pane_id: paneId, tab_id: tabId } of panes) {
    if (!paneId || !tabId) {
      continue;
    }
    notes.set(paneId, tabId);
    tabIds.add(tabId);
  }
  if (notes.size === 0) {
    return [];
  }
  await deps.fs.mkdirp(paneNoteDir(deps));
  await Promise.all([...notes].map(([paneId, tabId]) => writePaneNote(deps, paneId, tabId)));
  return [...tabIds];
}

function addTab(tabs: string[], tabId: string): string[] {
  if (!tabId) {
    return tabs;
  }
  if (tabs.includes(tabId)) {
    return tabs;
  }
  return [...tabs, tabId];
}

export async function resolveTabs(
  deps: PaneTabsDeps,
  event: PluginEvent,
): Promise<ResolveTabsResult> {
  const kind = classifyPluginEvent(event.event);
  if (kind === "startup") {
    return { tabIds: await seedLivePaneTabs(deps), skipped: false };
  }

  let tabIds: string[] = [];
  if (kind === "pane.created" || kind === "pane.moved") {
    const liveTab = await paneTab(deps, event.paneId);
    const destination = liveTab || event.tabId;
    tabIds = addTab(tabIds, destination);
    const data = eventData(event.eventJson);
    const previousTab = kind === "pane.moved" ? stringField(data.previous_tab_id) : "";
    const previousPane = kind === "pane.moved" ? stringField(data.previous_pane_id) : "";
    if (kind === "pane.moved") {
      tabIds = addTab(tabIds, previousTab);
    }
    if (liveTab) {
      await notePaneTab(deps, event.paneId, liveTab);
      if (kind === "pane.moved" && previousPane && previousPane !== event.paneId) {
        await removePaneNote(deps, previousPane);
      }
    }
  } else if (kind === "pane.closed") {
    if (event.paneId) {
      const noted = await readPaneTab(deps, event.paneId);
      if (noted !== null) {
        tabIds = addTab(tabIds, noted.trim());
        await removePaneNote(deps, event.paneId);
      } else {
        deps.log(`pane.closed: no tab note for pane ${event.paneId}; skipping`);
        return { tabIds: [], skipped: true };
      }
    } else {
      deps.log("pane.closed: no tab note for pane unknown; skipping");
      return { tabIds: [], skipped: true };
    }
  } else if (kind === "action") {
    tabIds = addTab(tabIds, event.tabId);
  } else {
    if (kind === "unknown") {
      deps.log(`unsupported plugin event ${event.event || "unknown"}; skipping`);
    }
    return { tabIds: [], skipped: true };
  }

  if (tabIds.length === 0 && event.workspaceId) {
    const active = await workspaceActiveTab(deps, event.workspaceId);
    tabIds = addTab(tabIds, active ?? "");
  }

  return { tabIds, skipped: false };
}

export function pluginEventFromEnv(env: Record<string, string | undefined>): PluginEvent {
  const event = env.HERDR_PLUGIN_EVENT ?? "";
  let eventJson: unknown;
  if (env.HERDR_PLUGIN_EVENT_JSON) {
    try {
      eventJson = JSON.parse(env.HERDR_PLUGIN_EVENT_JSON);
    } catch {
      eventJson = {};
    }
  }
  return {
    event,
    eventJson,
    paneId: env.HERDR_PANE_ID ?? "",
    tabId: env.HERDR_TAB_ID ?? "",
    workspaceId: env.HERDR_WORKSPACE_ID ?? "",
  };
}
