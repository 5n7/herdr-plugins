import { describe, expect, test } from "bun:test";
import { hexKey } from "./hex";
import { createHost, createPluginLog, requiredEnv, runPlugin } from "./host";

async function withEnv(
  name: string,
  value: string | undefined,
  run: () => Promise<void> | void,
): Promise<void> {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

describe("createPluginLog", () => {
  test("uses HERDR_PLUGIN_ID and does not double-prefix errors", async () => {
    const lines: unknown[][] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args);
    };
    try {
      await withEnv("HERDR_PLUGIN_ID", "from-env", () => {
        const log = createPluginLog("fallback");
        expect(log.prefix).toBe("from-env");
        log.log("hello");
        log.logError(new Error("from-env: already"));
        log.logError(new Error("plain"));
        log.logError("text");
      });
    } finally {
      console.error = error;
    }
    expect(lines).toEqual([
      ["from-env: hello"],
      ["from-env: already"],
      ["from-env: plain"],
      ["from-env: text"],
    ]);
  });

  test("falls back to the plugin id", async () => {
    await withEnv("HERDR_PLUGIN_ID", undefined, () => {
      expect(createPluginLog("fallback").prefix).toBe("fallback");
    });
  });
});

describe("requiredEnv", () => {
  test("returns a set variable", async () => {
    await withEnv("HERDR_HOST_TEST", "/tmp/sock", () => {
      expect(requiredEnv("HERDR_HOST_TEST", () => {})).toBe("/tmp/sock");
    });
  });

  test("logs and exits when a variable is missing or empty", async () => {
    const messages: string[] = [];
    const exit = process.exit;
    process.exit = (() => {
      throw new Error("exit");
    }) as typeof process.exit;
    try {
      await withEnv("HERDR_HOST_TEST", undefined, () => {
        expect(() => requiredEnv("HERDR_HOST_TEST", (message) => messages.push(message))).toThrow(
          "exit",
        );
        process.env.HERDR_HOST_TEST = "";
        expect(() => requiredEnv("HERDR_HOST_TEST", (message) => messages.push(message))).toThrow(
          "exit",
        );
      });
    } finally {
      process.exit = exit;
    }
    expect(messages).toEqual(["HERDR_HOST_TEST is not set", "HERDR_HOST_TEST is not set"]);
  });
});

describe("createHost", () => {
  test("shares socket identity between pane and coalesce deps", () => {
    const log = (): void => {};
    const host = createHost({
      id: "herdr-even-layout",
      socketPath: "/tmp/herdr.sock",
      stateDir: "/state",
      log,
    });
    expect(host.paneTabs.stateDir).toBe("/state");
    expect(host.paneTabs.socketKey).toBe(hexKey("/tmp/herdr.sock"));
    expect(host.paneTabs.pid).toBe(host.coalesce.process.pid);
    expect(host.coalesce.fs).toBe(host.paneTabs.fs);
    expect(host.coalesce.log).toBe(log);
    expect(host.coalesce.socketKey).toBe(host.paneTabs.socketKey);
    expect(host.coalesce.stateDir).toBe("/state");
  });
});

describe("runPlugin", () => {
  async function captureExit(main: () => Promise<number>): Promise<number> {
    const exit = process.exit;
    process.exit = ((code: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit;
    try {
      await runPlugin(createPluginLog("host-test"), main);
      throw new Error("runPlugin returned");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const match = /^exit (\d+)$/.exec(message);
      if (!match?.[1]) throw error;
      return Number(match[1]);
    } finally {
      process.exit = exit;
    }
  }

  test("exits with the status returned by main", async () => {
    expect(await captureExit(async () => 0)).toBe(0);
    expect(await captureExit(async () => 1)).toBe(1);
  });

  test("logs a thrown error and exits 1", async () => {
    const lines: unknown[][] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args);
    };
    try {
      await withEnv("HERDR_PLUGIN_ID", undefined, async () => {
        expect(
          await captureExit(async () => {
            throw new Error("boom");
          }),
        ).toBe(1);
      });
    } finally {
      console.error = error;
    }
    expect(lines).toEqual([["host-test: boom"]]);
  });
});
