import type { CoalesceDeps } from "./coalesce";
import { nodeFs } from "./fs";
import { hexKey } from "./hex";
import type { PaneTabsDeps } from "./pane-tabs";
import { hostClock, hostProcess } from "./process";
import { createHerdrRpc, unixTransport } from "./rpc";

export type PluginLog = {
  prefix: string;
  log: (message: string) => void;
  logError: (error: unknown) => void;
};

export type HostDeps = {
  paneTabs: PaneTabsDeps;
  coalesce: CoalesceDeps;
};

export function createPluginLog(defaultId: string): PluginLog {
  const prefix = process.env.HERDR_PLUGIN_ID ?? defaultId;
  const log = (message: string): void => {
    console.error(`${prefix}: ${message}`);
  };
  return {
    prefix,
    log,
    logError(error: unknown): void {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith(`${prefix}:`)) {
        console.error(message);
        return;
      }
      log(message);
    },
  };
}

export function requiredEnv(name: string, log: (message: string) => void): string {
  const value = process.env[name];
  if (!value) {
    log(`${name} is not set`);
    process.exit(1);
  }
  return value;
}

export function createHost(options: {
  id: string;
  socketPath: string;
  stateDir: string;
  log: (message: string) => void;
}): HostDeps {
  const paneTabs: PaneTabsDeps = {
    fs: nodeFs,
    rpc: createHerdrRpc({
      transport: unixTransport(options.socketPath),
      id: options.id,
    }),
    stateDir: options.stateDir,
    socketKey: hexKey(options.socketPath),
    log: options.log,
    pid: hostProcess.pid,
  };
  return {
    paneTabs,
    coalesce: {
      clock: hostClock,
      fs: paneTabs.fs,
      log: paneTabs.log,
      process: hostProcess,
      socketKey: paneTabs.socketKey,
      stateDir: paneTabs.stateDir,
    },
  };
}

export async function runPlugin(log: PluginLog, main: () => Promise<number>): Promise<never> {
  let code: number;
  try {
    code = await main();
  } catch (error) {
    log.logError(error);
    code = 1;
  }
  process.exit(code);
}
