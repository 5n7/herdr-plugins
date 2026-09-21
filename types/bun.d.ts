declare module "bun" {
  type Data = string | Uint8Array;
  type Sock = {
    write: (data: Data) => number | undefined;
    end: () => void;
  };
  type Handlers = {
    open?: (socket: Sock) => void;
    data?: (socket: Sock, data: Data) => void;
    error?: (socket: Sock, error: unknown) => void;
    close?: () => void;
  };
  export function connect(opts: { unix: string; socket: Handlers }): Promise<Sock>;
  export function listen(opts: { unix: string; socket: Handlers }): {
    stop: (close?: boolean) => void;
  };
  export function sleep(ms: number): Promise<void>;
}

declare module "bun:test" {
  type TestBody = () => void | Promise<void>;
  type Matchers = {
    rejects: Omit<Matchers, "rejects">;
    toBe: (expected: unknown) => void;
    toBeGreaterThan: (expected: number) => void;
    toBeGreaterThanOrEqual: (expected: number) => void;
    toBeNull: () => void;
    toEqual: (expected: unknown) => void;
    toThrow: (expected?: string | RegExp) => void;
  };

  export function describe(name: string, body: TestBody): void;
  export function expect(actual: unknown): Matchers;
  export function test(name: string, body: TestBody): void;
}

declare const Bun: typeof import("bun");
