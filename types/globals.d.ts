declare const process: {
  env: Record<string, string | undefined>;
  pid: number;
  kill: (pid: number, signal?: number) => boolean;
  exit: (code: number) => never;
};

declare const console: {
  error: (...args: unknown[]) => void;
};

declare class TextEncoder {
  encode: (input: string) => Uint8Array;
}

declare class TextDecoder {
  decode: (input?: Uint8Array, options?: { stream?: boolean }) => string;
}

declare function setTimeout(handler: () => void, ms: number): unknown;
declare function clearTimeout(id: unknown): void;
