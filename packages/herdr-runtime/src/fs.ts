import { mkdir, readdir, readFile, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";

export type PluginFs = {
  exists: (path: string) => Promise<boolean>;
  mkdir: (path: string) => Promise<void>;
  mkdirp: (path: string) => Promise<void>;
  readdir: (path: string) => Promise<string[]>;
  readFile: (path: string) => Promise<string | null>;
  rename: (from: string, to: string) => Promise<void>;
  rm: (path: string) => Promise<void>;
  rmdir: (path: string) => Promise<void>;
  writeFile: (path: string, data: string) => Promise<void>;
};

export const nodeFs: PluginFs = {
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  },
  async mkdir(path) {
    await mkdir(path);
  },
  async mkdirp(path) {
    await mkdir(path, { recursive: true });
  },
  async readdir(path) {
    try {
      return await readdir(path);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
  },
  async readFile(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  },
  async rename(from, to) {
    await rename(from, to);
  },
  async rm(path) {
    try {
      await unlink(path);
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  },
  async rmdir(path) {
    await rmdir(path);
  },
  async writeFile(path, data) {
    await writeFile(path, data);
  },
};

export function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === code
  );
}

export function isAlreadyExists(error: unknown): boolean {
  return hasErrorCode(error, "EEXIST");
}

export function isNotFound(error: unknown): boolean {
  return hasErrorCode(error, "ENOENT");
}
