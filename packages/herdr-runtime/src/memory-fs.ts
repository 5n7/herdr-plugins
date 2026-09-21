import type { PluginFs } from "./fs";

class MemoryError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "MemoryError";
  }
}

function normalize(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

function parent(path: string): string {
  return path.replace(/\/[^/]+$/, "") || "/";
}

export function memoryFs(): PluginFs {
  const dirs = new Set<string>(["/"]);
  const files = new Map<string, string>();

  function assertParent(path: string): void {
    const parentPath = parent(path);
    if (files.has(parentPath)) {
      throw new MemoryError("ENOTDIR");
    }
    if (!dirs.has(parentPath)) {
      throw new MemoryError("ENOENT");
    }
  }

  function childName(dir: string, path: string): string | undefined {
    const prefix = dir === "/" ? "/" : `${dir}/`;
    if (!path.startsWith(prefix)) {
      return undefined;
    }
    const name = path.slice(prefix.length).split("/")[0];
    return name || undefined;
  }

  return {
    async exists(path) {
      const normalized = normalize(path);
      return dirs.has(normalized) || files.has(normalized);
    },
    async mkdir(path) {
      const dir = normalize(path);
      if (dirs.has(dir) || files.has(dir)) {
        throw new MemoryError("EEXIST");
      }
      assertParent(dir);
      dirs.add(dir);
    },
    async mkdirp(path) {
      const dir = normalize(path);
      const parts = dir.split("/").filter(Boolean);
      let current = "";
      for (const part of parts) {
        current += `/${part}`;
        if (files.has(current)) {
          throw new MemoryError(current === dir ? "EEXIST" : "ENOTDIR");
        }
        dirs.add(current);
      }
    },
    async readdir(path) {
      const dir = normalize(path);
      if (files.has(dir)) {
        throw new MemoryError("ENOTDIR");
      }
      if (!dirs.has(dir)) {
        return [];
      }
      const names = new Set<string>();
      for (const entry of dirs) {
        const name = childName(dir, entry);
        if (name) {
          names.add(name);
        }
      }
      for (const entry of files.keys()) {
        const name = childName(dir, entry);
        if (name) {
          names.add(name);
        }
      }
      return [...names];
    },
    async readFile(path) {
      const file = normalize(path);
      if (dirs.has(file)) {
        throw new MemoryError("EISDIR");
      }
      if (!files.has(file)) {
        return null;
      }
      return files.get(file) ?? null;
    },
    async rename(from, to) {
      const source = normalize(from);
      const target = normalize(to);
      if (!dirs.has(source) && !files.has(source)) {
        throw new MemoryError("ENOENT");
      }
      if (source === target) {
        return;
      }
      assertParent(target);

      if (files.has(source)) {
        if (dirs.has(target)) {
          throw new MemoryError("EISDIR");
        }
        const data = files.get(source);
        files.delete(source);
        files.set(target, data ?? "");
        return;
      }

      if (target.startsWith(`${source}/`)) {
        throw new MemoryError("EINVAL");
      }
      if (files.has(target)) {
        throw new MemoryError("ENOTDIR");
      }
      const targetPrefix = `${target}/`;
      if (
        dirs.has(target) &&
        ([...dirs].some((dir) => dir.startsWith(targetPrefix)) ||
          [...files.keys()].some((file) => file.startsWith(targetPrefix)))
      ) {
        throw new MemoryError("ENOTEMPTY");
      }

      const sourcePrefix = `${source}/`;
      const movedDirs = [...dirs].filter((dir) => dir === source || dir.startsWith(sourcePrefix));
      const movedFiles = [...files].filter(([file]) => file.startsWith(sourcePrefix));
      dirs.delete(target);
      for (const dir of movedDirs) {
        dirs.delete(dir);
        dirs.add(target + dir.slice(source.length));
      }
      for (const [file, data] of movedFiles) {
        files.delete(file);
        files.set(target + file.slice(source.length), data);
      }
    },
    async rm(path) {
      const file = normalize(path);
      if (dirs.has(file)) {
        throw new MemoryError("EISDIR");
      }
      files.delete(file);
    },
    async rmdir(path) {
      const dir = normalize(path);
      if (dir === "/") {
        throw new MemoryError("EBUSY");
      }
      if (files.has(dir)) {
        throw new MemoryError("ENOTDIR");
      }
      if (!dirs.has(dir)) {
        throw new MemoryError("ENOENT");
      }
      const prefix = `${dir}/`;
      if (
        [...dirs].some((entry) => entry.startsWith(prefix)) ||
        [...files.keys()].some((entry) => entry.startsWith(prefix))
      ) {
        throw new MemoryError("ENOTEMPTY");
      }
      dirs.delete(dir);
    },
    async writeFile(path, data) {
      const file = normalize(path);
      if (dirs.has(file)) {
        throw new MemoryError("EISDIR");
      }
      assertParent(file);
      files.set(file, data);
    },
  };
}
