import { type PaneTabsDeps, seedLivePaneTabs } from "../../../packages/herdr-runtime/src/pane-tabs";
import { interpretResponse } from "../../../packages/herdr-runtime/src/rpc";
import { interpretExport, type PendingSplit } from "./layout";

const MAX_EXPORT_FAILURES = 3;
const MAX_APPLIES = 3;

async function applyRatios(
  deps: PaneTabsDeps,
  tabId: string,
  pending: PendingSplit[],
): Promise<void> {
  for (const split of pending) {
    const response = await deps.rpc.call("layout.set_split_ratio", {
      tab_id: tabId,
      path: split.path,
      ratio: split.want,
    });
    const outcome = interpretResponse(
      response,
      (rpc) => (rpc.result as { type?: unknown } | undefined)?.type,
    );
    if (outcome.kind !== "ok" || outcome.value !== "layout_split_ratio_set") {
      const code = outcome.kind === "ok" ? String(outcome.value) : outcome.code;
      deps.log(
        `${tabId}: set_split_ratio ${JSON.stringify(split.path)} ${split.want} failed: ${code}`,
      );
    }
  }
}

async function runEvenTab(
  deps: PaneTabsDeps,
  tabId: string,
  onSuccessfulExport: () => Promise<void>,
): Promise<void> {
  let exportFailures = 0;
  let applies = 0;

  while (true) {
    const response = await deps.rpc.call("layout.export", { tab_id: tabId });
    const outcome = interpretExport(response);
    if (outcome.kind === "gone") {
      return;
    }
    if (outcome.kind === "fail") {
      exportFailures += 1;
      deps.log(`${tabId}: layout.export failed: ${outcome.code} (attempt ${exportFailures})`);
      if (exportFailures >= MAX_EXPORT_FAILURES) {
        throw new Error(`${tabId}: layout.export failed`);
      }
      continue;
    }
    await onSuccessfulExport();
    if (outcome.pending.length === 0) {
      return;
    }
    if (applies >= MAX_APPLIES) {
      deps.log(`${tabId}: still uneven after ${applies} applies`);
      throw new Error(`${tabId}: still uneven after ${applies} applies`);
    }
    await applyRatios(deps, tabId, outcome.pending);
    applies += 1;
  }
}

export function createEvenInvocation(
  deps: PaneTabsDeps,
  panesSeeded = false,
): (tabId: string) => Promise<void> {
  let seedPromise: Promise<void> | undefined = panesSeeded ? Promise.resolve() : undefined;
  const seedOnce = () => {
    if (!seedPromise) {
      const pending = seedLivePaneTabs(deps).then(() => undefined);
      seedPromise = pending;
      void pending.catch(() => {
        if (seedPromise === pending) {
          seedPromise = undefined;
        }
      });
    }
    return seedPromise;
  };
  return (tabId) => runEvenTab(deps, tabId, seedOnce);
}

export function evenTab(deps: PaneTabsDeps, tabId: string): Promise<void> {
  return createEvenInvocation(deps)(tabId);
}
