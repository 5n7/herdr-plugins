export type JsonRpcRequest = {
  id: string;
  method: string;
  params: unknown;
};

export type JsonRpcError = {
  code?: string;
  message?: string;
};

export type JsonRpcResponse = {
  id?: string;
  result?: unknown;
  error?: JsonRpcError;
};

export type RpcOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "missing"; code: string }
  | { kind: "fail"; code: string };

export type LineTransport = {
  /** Exchange one newline-terminated request frame for one response frame. */
  exchange: (frame: string, timeoutMs: number) => Promise<string>;
};

export type HerdrRpc = {
  call: (method: string, params?: unknown) => Promise<JsonRpcResponse>;
};

export const RPC_MAX_RESPONSE_BYTES = 1024 * 1024;
export const RPC_TIMEOUT_MS = 5000;

export class RpcError extends Error {
  readonly code: string;

  constructor(code: string, label: string) {
    super(`${label} failed: ${code}`);
    this.code = code;
    this.name = "RpcError";
  }
}

export function encodeRequest(id: string, method: string, params: unknown = {}): string {
  const body: JsonRpcRequest = { id, method, params: params ?? {} };
  return `${JSON.stringify(body)}\n`;
}

export function parseResponse(raw: string): JsonRpcResponse {
  const text = raw.replace(/^\uFEFF/, "").trim();
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("transport");
  }
  return parsed as JsonRpcResponse;
}

export function interpretResponse<T>(
  response: JsonRpcResponse,
  read: (response: JsonRpcResponse) => T | undefined | null,
  missingCode?: string,
): RpcOutcome<T> {
  if (missingCode && response.error?.code === missingCode) {
    return { kind: "missing", code: missingCode };
  }
  try {
    const value = read(response);
    if (value !== undefined && value !== null) {
      return { kind: "ok", value };
    }
  } catch {
    return { kind: "fail", code: "transport" };
  }
  return { kind: "fail", code: response.error?.code ?? "transport" };
}

export function requireField<T>(outcome: RpcOutcome<T>, label: string): T | null {
  if (outcome.kind === "missing") {
    return null;
  }
  if (outcome.kind === "ok") {
    return outcome.value;
  }
  throw new RpcError(outcome.code, label);
}

export async function call(
  transport: LineTransport,
  id: string,
  method: string,
  params: unknown = {},
  timeoutMs = RPC_TIMEOUT_MS,
): Promise<JsonRpcResponse> {
  const frame = encodeRequest(id, method, params);
  let raw: string;
  try {
    raw = await transport.exchange(frame, timeoutMs);
  } catch {
    return { error: { code: "transport" } };
  }
  try {
    return parseResponse(raw);
  } catch {
    return { error: { code: "transport" } };
  }
}

export function unixTransport(
  socketPath: string,
  maxResponseBytes = RPC_MAX_RESPONSE_BYTES,
): LineTransport {
  return {
    exchange(frame, timeoutMs) {
      return new Promise((resolve, reject) => {
        let buffer = "";
        let bufferBytes = 0;
        let settled = false;
        let sock: { end: () => void } | undefined;
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        const requestFrame = frame.endsWith("\n") ? frame : `${frame}\n`;
        const timer = setTimeout(() => finish(new Error("transport")), timeoutMs);

        const finish = (err: Error | null, value?: string) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          try {
            sock?.end();
          } catch {
            // The peer may already have closed.
          }
          if (err) {
            reject(err);
          } else {
            resolve(value ?? "");
          }
        };

        void Bun.connect({
          unix: socketPath,
          socket: {
            open(socket) {
              sock = socket;
              socket.write(requestFrame);
            },
            data(_socket, data) {
              const newline = typeof data === "string" ? data.indexOf("\n") : data.indexOf(0x0a);
              const frameData = newline === -1 ? data : data.slice(0, newline);
              bufferBytes +=
                (typeof frameData === "string"
                  ? encoder.encode(frameData).byteLength
                  : frameData.byteLength) + (newline === -1 ? 0 : 1);
              if (bufferBytes > maxResponseBytes) {
                finish(new Error("transport"));
                return;
              }
              buffer +=
                typeof frameData === "string"
                  ? frameData
                  : decoder.decode(frameData, { stream: newline === -1 });
              if (newline !== -1) {
                if (typeof frameData !== "string") {
                  buffer += decoder.decode();
                }
                finish(null, buffer);
              }
            },
            error(_socket, error) {
              finish(error instanceof Error ? error : new Error("transport"));
            },
            close() {
              if (settled) {
                return;
              }
              buffer += decoder.decode();
              if (buffer.trim()) {
                finish(null, buffer.trimEnd());
              } else {
                finish(new Error("transport"));
              }
            },
          },
        }).catch((error: unknown) => {
          finish(error instanceof Error ? error : new Error("transport"));
        });
      });
    },
  };
}

export function createHerdrRpc(opts: {
  transport: LineTransport;
  id: string;
  timeoutMs?: number;
}): HerdrRpc {
  return {
    call(method, params = {}) {
      return call(opts.transport, opts.id, method, params, opts.timeoutMs ?? RPC_TIMEOUT_MS);
    },
  };
}
