import { hasErrorCode, isAlreadyExists, type PluginFs } from "./fs";
import { hexKey } from "./hex";
import type { Clock, ProcessTable } from "./process";

export type CoalesceDeps = {
  clock: Clock;
  fs: PluginFs;
  log: (message: string) => void;
  process: ProcessTable;
  socketKey: string;
  stateDir: string;
};

const STALE_GRACE_ATTEMPTS = 10;
const STALE_GRACE_MS = 50;

async function ownerAlive(deps: CoalesceDeps, lockDir: string): Promise<boolean> {
  const raw = await deps.fs.readFile(`${lockDir}/owner`);
  if (raw === null) {
    return false;
  }
  const owner = raw.trim();
  if (!owner || /[^0-9]/.test(owner)) {
    return false;
  }
  return deps.process.alive(Number(owner));
}

async function writeOwner(deps: CoalesceDeps, lockDir: string, owner: string): Promise<void> {
  await deps.fs.writeFile(`${lockDir}/owner`, `${owner}\n`);
}

async function createLock(deps: CoalesceDeps, lockDir: string, owner: string): Promise<boolean> {
  try {
    await deps.fs.mkdir(lockDir);
  } catch (error) {
    if (isAlreadyExists(error)) {
      return false;
    }
    throw error;
  }
  try {
    await writeOwner(deps, lockDir, owner);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    try {
      await deps.fs.rm(`${lockDir}/owner`);
      await deps.fs.rmdir(lockDir);
    } catch (cleanupError) {
      if (!hasErrorCode(cleanupError, "ENOENT") && !hasErrorCode(cleanupError, "ENOTEMPTY")) {
        throw new AggregateError([error, cleanupError], `could not clean up tab lock ${lockDir}`);
      }
    }
    throw error;
  }
}

async function releaseLock(
  deps: CoalesceDeps,
  lockDir: string,
  expectedOwner: string,
): Promise<boolean> {
  const raw = await deps.fs.readFile(`${lockDir}/owner`);
  const owner = raw?.trim() ?? "";
  if (owner !== expectedOwner) {
    return false;
  }
  await deps.fs.rm(`${lockDir}/owner`);
  await deps.fs.rmdir(lockDir);
  return true;
}

export async function acquireTabLock(
  deps: CoalesceDeps,
  lockDir: string,
  owner: string,
): Promise<boolean> {
  if (await createLock(deps, lockDir, owner)) {
    return true;
  }
  if (await ownerAlive(deps, lockDir)) {
    return false;
  }

  for (let attempt = 0; attempt < STALE_GRACE_ATTEMPTS; attempt++) {
    await deps.clock.sleep(STALE_GRACE_MS);
    if (await createLock(deps, lockDir, owner)) {
      return true;
    }
    if (await ownerAlive(deps, lockDir)) {
      return false;
    }
  }

  let staleDir = `${lockDir}.stale.${owner}`;
  let staleSuffix = 0;
  while (await deps.fs.exists(staleDir)) {
    staleSuffix += 1;
    staleDir = `${lockDir}.stale.${owner}.${staleSuffix}`;
  }
  try {
    await deps.fs.rename(lockDir, staleDir);
  } catch (error) {
    if (
      hasErrorCode(error, "EEXIST") ||
      hasErrorCode(error, "ENOENT") ||
      hasErrorCode(error, "ENOTEMPTY")
    ) {
      return false;
    }
    throw error;
  }
  await deps.fs.rm(`${staleDir}/owner`);
  try {
    await deps.fs.rmdir(staleDir);
  } catch {
    deps.log(`could not remove stale tab lock ${staleDir}`);
  }
  return createLock(deps, lockDir, owner);
}

async function clearPending(deps: CoalesceDeps, pendingDir: string): Promise<void> {
  const names = await deps.fs.readdir(pendingDir);
  await Promise.all(names.map((name) => deps.fs.rm(`${pendingDir}/${name}`)));
}

async function hasPending(deps: CoalesceDeps, pendingDir: string): Promise<boolean> {
  return (await deps.fs.readdir(pendingDir)).length > 0;
}

export async function coalesceTabWork(
  deps: CoalesceDeps,
  tabId: string,
  worker: (tabId: string) => Promise<void>,
): Promise<void> {
  const owner = String(deps.process.pid);
  const workDir = `${deps.stateDir}/work/${deps.socketKey}/${hexKey(tabId)}`;
  const pendingDir = `${workDir}/pending`;
  const lockDir = `${workDir}/lock`;
  await deps.fs.mkdirp(pendingDir);
  await deps.fs.writeFile(`${pendingDir}/${owner}`, "");

  if (!(await acquireTabLock(deps, lockDir, owner))) {
    return;
  }

  let failed: Error | undefined;
  try {
    while (true) {
      await clearPending(deps, pendingDir);
      try {
        await worker(tabId);
        failed = undefined;
      } catch (error) {
        failed = error instanceof Error ? error : new Error(String(error));
      }
      if (!(await releaseLock(deps, lockDir, owner))) {
        throw new Error(`could not release tab lock ${lockDir}`);
      }
      if (!(await hasPending(deps, pendingDir))) {
        break;
      }
      if (!(await acquireTabLock(deps, lockDir, owner))) {
        break;
      }
    }
  } finally {
    await releaseLock(deps, lockDir, owner).catch(() => undefined);
  }

  if (failed) {
    throw failed;
  }
}
