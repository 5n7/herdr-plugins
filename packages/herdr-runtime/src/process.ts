import { hasErrorCode } from "./fs";

export type Clock = {
  sleep: (ms: number) => Promise<void>;
};

export type ProcessTable = {
  alive: (pid: number) => boolean;
  pid: number;
};

export const hostClock: Clock = {
  sleep(ms) {
    return Bun.sleep(ms);
  },
};

export const hostProcess: ProcessTable = {
  alive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return hasErrorCode(error, "EPERM");
    }
  },
  pid: process.pid,
};
