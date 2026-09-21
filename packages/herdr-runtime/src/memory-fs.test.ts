import { describe, expect, test } from "bun:test";
import { memoryFs } from "./memory-fs";

describe("memoryFs", () => {
  test("requires parent directories for non-recursive operations", async () => {
    const fs = memoryFs();
    await expect(fs.mkdir("/missing/child")).rejects.toThrow("ENOENT");
    await expect(fs.writeFile("/missing/file", "data")).rejects.toThrow("ENOENT");
    await fs.mkdir("/source");
    await fs.writeFile("/source/file", "data");
    await expect(fs.rename("/source/file", "/missing/file")).rejects.toThrow("ENOENT");
  });

  test("rejects removing a non-empty directory", async () => {
    const fs = memoryFs();
    await fs.mkdirp("/parent/child");
    await expect(fs.rmdir("/parent")).rejects.toThrow("ENOTEMPTY");
  });

  test("lists immediate file and directory children", async () => {
    const fs = memoryFs();
    await fs.mkdirp("/parent/child/grandchild");
    await fs.writeFile("/parent/file", "data");
    expect((await fs.readdir("/parent")).sort()).toEqual(["child", "file"]);
  });

  test("moves a directory with all nested entries", async () => {
    const fs = memoryFs();
    await fs.mkdirp("/from/child");
    await fs.mkdir("/to-parent");
    await fs.writeFile("/from/child/file", "data");
    await fs.rename("/from", "/to-parent/to");

    expect(await fs.exists("/from")).toBe(false);
    expect(await fs.exists("/from/child")).toBe(false);
    expect(await fs.readFile("/to-parent/to/child/file")).toBe("data");
  });
});
