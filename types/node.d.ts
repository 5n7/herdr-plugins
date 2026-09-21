declare module "node:fs/promises" {
  export function mkdtemp(prefix: string): Promise<string>;
  export function mkdir(path: string, opts?: { recursive?: boolean }): Promise<string | undefined>;
  export function readdir(path: string): Promise<string[]>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function rename(from: string, to: string): Promise<void>;
  export function rm(path: string, opts?: { force?: boolean; recursive?: boolean }): Promise<void>;
  export function rmdir(path: string): Promise<void>;
  export function stat(path: string): Promise<unknown>;
  export function unlink(path: string): Promise<void>;
  export function writeFile(path: string, data: string): Promise<void>;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
}
