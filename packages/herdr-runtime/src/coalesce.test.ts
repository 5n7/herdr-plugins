import { describe, expect, test } from "bun:test";
import { acquireTabLock, type CoalesceDeps, coalesceTabWork } from "./coalesce";
import { memoryFs } from "./memory-fs";
import type { Clock, ProcessTable } from "./process";

function instantClock(): Clock {
  return { sleep: async () => undefined };
}

function processTable(pid: number, live: Set<number>): ProcessTable {
  return {
    pid,
    alive(id) {
      return live.has(id);
    },
  };
}

function deps(pid: number, live: Set<number>, fs = memoryFs()): CoalesceDeps {
  return {
    clock: instantClock(),
    fs,
    log: () => undefined,
    process: processTable(pid, live),
    socketKey: "sock",
    stateDir: "/state",
  };
}

function errno(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

describe("acquireTabLock", () => {
  test("recovers a lock whose owner is dead", async () => {
    const fs = memoryFs();
    const live = new Set<number>([2]);
    const stale = deps(1, new Set(), fs);
    const lockDir = "/state/work/sock/tab/lock";
    await fs.mkdirp("/state/work/sock/tab");
    expect(await acquireTabLock(stale, lockDir, "1")).toBe(true);
    live.add(2);
    const recovered = deps(2, live, fs);
    expect(await acquireTabLock(recovered, lockDir, "2")).toBe(true);
    expect(await fs.readFile(`${lockDir}/owner`)).toBe("2\n");
  });

  test("does not steal a lock from a live owner", async () => {
    const fs = memoryFs();
    const live = new Set([1, 2]);
    await fs.mkdirp("/state/work/sock/tab");
    expect(await acquireTabLock(deps(1, live, fs), "/state/work/sock/tab/lock", "1")).toBe(true);
    expect(await acquireTabLock(deps(2, live, fs), "/state/work/sock/tab/lock", "2")).toBe(false);
  });

  test("propagates an owner write failure after cleaning up the lock directory", async () => {
    const fs = memoryFs();
    const failure = errno("EACCES");
    await fs.mkdirp("/state/work/sock/tab");
    fs.writeFile = async () => {
      throw failure;
    };

    await expect(
      acquireTabLock(deps(1, new Set(), fs), "/state/work/sock/tab/lock", "1"),
    ).rejects.toBe(failure);
    expect(await fs.exists("/state/work/sock/tab/lock")).toBe(false);
  });

  test("propagates a stale lock rename failure that is not a race", async () => {
    const fs = memoryFs();
    const d = deps(1, new Set(), fs);
    const lockDir = "/state/work/sock/tab/lock";
    await fs.mkdirp("/state/work/sock/tab");
    expect(await acquireTabLock(d, lockDir, "1")).toBe(true);
    const failure = errno("EACCES");
    fs.rename = async () => {
      throw failure;
    };

    await expect(acquireTabLock(deps(2, new Set(), fs), lockDir, "2")).rejects.toBe(failure);
  });
});

describe("coalesceTabWork", () => {
  test("reruns when a marker arrives during the worker", async () => {
    const shared = memoryFs();
    const live = new Set([10]);
    const d = deps(10, live, shared);
    const runs: number[] = [];
    await coalesceTabWork(d, "tab", async () => {
      runs.push(runs.length + 1);
      if (runs.length === 1) {
        await shared.writeFile("/state/work/sock/746162/pending/extra", "");
      }
    });
    expect(runs).toEqual([1, 2]);
  });

  test("returns without running when the lock is held", async () => {
    const shared = memoryFs();
    const live = new Set([1, 2]);
    await shared.mkdirp("/state/work/sock/746162");
    expect(await acquireTabLock(deps(1, live, shared), "/state/work/sock/746162/lock", "1")).toBe(
      true,
    );
    let ran = 0;
    await coalesceTabWork(deps(2, live, shared), "tab", async () => {
      ran += 1;
    });
    expect(ran).toBe(0);
    expect(await shared.exists("/state/work/sock/746162/pending/2")).toBe(true);
  });

  test("clears an earlier failure when a pending rerun succeeds", async () => {
    const fs = memoryFs();
    let runs = 0;
    await coalesceTabWork(deps(1, new Set([1]), fs), "tab", async () => {
      runs += 1;
      if (runs === 1) {
        await fs.writeFile("/state/work/sock/746162/pending/retry", "");
        throw new Error("retryable");
      }
    });
    expect(runs).toBe(2);
  });

  test("propagates the final worker failure", async () => {
    const failure = new Error("failed");
    await expect(
      coalesceTabWork(deps(1, new Set([1])), "tab", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
