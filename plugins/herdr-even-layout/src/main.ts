import { coalesceTabWork, type CoalesceDeps } from "../../../packages/herdr-runtime/src/coalesce";
import { nodeFs } from "../../../packages/herdr-runtime/src/fs";
import { hexKey } from "../../../packages/herdr-runtime/src/hex";
import {
  type PaneTabsDeps,
  pluginEventFromEnv,
  resolveTabs,
} from "../../../packages/herdr-runtime/src/pane-tabs";
import { hostClock, hostProcess } from "../../../packages/herdr-runtime/src/process";
import { createHerdrRpc, unixTransport } from "../../../packages/herdr-runtime/src/rpc";
import { createEvenInvocation } from "./even";

const LOG_PREFIX = process.env.HERDR_PLUGIN_ID ?? "herdr-even-layout";

function log(message: string): void {
  console.error(`${LOG_PREFIX}: ${message}`);
}

function logError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith(`${LOG_PREFIX}:`)) {
    console.error(message);
  } else {
    log(message);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    log(`${name} is not set`);
    process.exit(1);
  }
  return value;
}

const socketPath = requiredEnv("HERDR_SOCKET_PATH");
const stateDir = requiredEnv("HERDR_PLUGIN_STATE_DIR");

const deps: PaneTabsDeps = {
  fs: nodeFs,
  rpc: createHerdrRpc({
    transport: unixTransport(socketPath),
    id: LOG_PREFIX,
  }),
  stateDir,
  socketKey: hexKey(socketPath),
  log,
  pid: hostProcess.pid,
};

const coalesceDeps: CoalesceDeps = {
  clock: hostClock,
  fs: deps.fs,
  log,
  process: hostProcess,
  socketKey: deps.socketKey,
  stateDir: deps.stateDir,
};

const event = pluginEventFromEnv(process.env);

async function main(): Promise<number> {
  const { tabIds } = await resolveTabs(deps, event);
  const runEvenTab = createEvenInvocation(deps, event.event === "startup");
  const results = await Promise.allSettled(
    tabIds.map((tabId) => coalesceTabWork(coalesceDeps, tabId, runEvenTab)),
  );
  let failed = false;
  for (const result of results) {
    if (result.status === "rejected") {
      logError(result.reason);
      failed = true;
    }
  }
  return failed ? 1 : 0;
}

try {
  process.exit(await main());
} catch (error) {
  logError(error);
  process.exit(1);
}
