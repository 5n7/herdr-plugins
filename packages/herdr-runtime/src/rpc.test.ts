import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  call,
  encodeRequest,
  interpretResponse,
  type JsonRpcResponse,
  parseResponse,
  RPC_MAX_RESPONSE_BYTES,
  unixTransport,
} from "./rpc";

describe("encodeRequest", () => {
  test("writes newline-delimited JSON-RPC", () => {
    expect(encodeRequest("even", "pane.get", { pane_id: "p1" })).toBe(
      '{"id":"even","method":"pane.get","params":{"pane_id":"p1"}}\n',
    );
  });
  test("defaults params to an empty object", () => {
    expect(JSON.parse(encodeRequest("even", "pane.list"))).toEqual({
      id: "even",
      method: "pane.list",
      params: {},
    });
  });
});

describe("call", () => {
  test("passes the encoded request frame to the transport unchanged", async () => {
    let exchanged = "";
    const response = await call(
      {
        exchange(line) {
          exchanged = line;
          return Promise.resolve('{"id":"even","result":{"ok":true}}');
        },
      },
      "even",
      "pane.list",
    );

    expect(exchanged).toBe('{"id":"even","method":"pane.list","params":{}}\n');
    expect(response).toEqual({ id: "even", result: { ok: true } });
  });
});

describe("interpretResponse", () => {
  test("maps a missing code before reading the result", () => {
    const response: JsonRpcResponse = {
      error: { code: "pane_not_found" },
      result: { pane: { tab_id: "t" } },
    };
    expect(
      interpretResponse(
        response,
        (rpc) => (rpc.result as { pane: { tab_id: string } }).pane.tab_id,
        "pane_not_found",
      ),
    ).toEqual({
      kind: "missing",
      code: "pane_not_found",
    });
  });
  test("reads a present field as ok", () => {
    const response: JsonRpcResponse = { result: { pane: { tab_id: "tab-1" } } };
    expect(
      interpretResponse(
        response,
        (rpc) => (rpc.result as { pane: { tab_id: string } }).pane.tab_id,
        "pane_not_found",
      ),
    ).toEqual({
      kind: "ok",
      value: "tab-1",
    });
  });
  test("maps other errors to fail with the server code", () => {
    const response: JsonRpcResponse = { error: { code: "boom" } };
    expect(interpretResponse(response, (rpc) => rpc.result, "pane_not_found")).toEqual({
      kind: "fail",
      code: "boom",
    });
  });
  test("uses transport when the payload is not an object", () => {
    expect(parseResponse.bind(null, "[]")).toThrow();
  });
});

describe("unixTransport", () => {
  test("uses a bounded response buffer by default", () => {
    expect(RPC_MAX_RESPONSE_BYTES).toBe(1024 * 1024);
  });

  test("frames one request line and one response line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herdr-rpc-"));
    const socketPath = join(dir, "sock");
    let received = "";
    const server = Bun.listen({
      unix: socketPath,
      socket: {
        data(socket, data) {
          received += typeof data === "string" ? data : new TextDecoder().decode(data);
          socket.write('{"id":"even","result":{"ok":true}}\n');
        },
      },
    });
    try {
      const response = await call(unixTransport(socketPath), "even", "pane.list", {});
      expect(received).toBe('{"id":"even","method":"pane.list","params":{}}\n');
      expect(response).toEqual({ id: "even", result: { ok: true } });
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("terminates a direct request frame with a newline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herdr-rpc-"));
    const socketPath = join(dir, "sock");
    let received = "";
    const server = Bun.listen({
      unix: socketPath,
      socket: {
        data(socket, data) {
          received += typeof data === "string" ? data : new TextDecoder().decode(data);
          socket.write('{"id":"even","result":{}}\n');
        },
      },
    });
    try {
      await unixTransport(socketPath).exchange('{"id":"even"}', 5000);
      expect(received).toBe('{"id":"even"}\n');
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("decodes a multibyte UTF-8 character split across socket chunks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herdr-rpc-"));
    const socketPath = join(dir, "sock");
    const responseBytes = new TextEncoder().encode('{"id":"even","result":{"label":"café"}}\n');
    const splitAt = responseBytes.indexOf(0xc3) + 1;
    const server = Bun.listen({
      unix: socketPath,
      socket: {
        data(socket) {
          socket.write(responseBytes.slice(0, splitAt));
          setTimeout(() => socket.write(responseBytes.slice(splitAt)), 5);
        },
      },
    });
    try {
      const response = await call(unixTransport(socketPath), "even", "pane.list", {});
      expect(response).toEqual({ id: "even", result: { label: "café" } });
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("times out as transport when the server never answers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herdr-rpc-"));
    const socketPath = join(dir, "sock");
    const server = Bun.listen({
      unix: socketPath,
      socket: {
        data() {
          // Hold the connection open without a reply.
        },
      },
    });
    try {
      const response = await call(unixTransport(socketPath), "even", "pane.list", {}, 50);
      expect(response).toEqual({ error: { code: "transport" } });
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects a response larger than the configured buffer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herdr-rpc-"));
    const socketPath = join(dir, "sock");
    const server = Bun.listen({
      unix: socketPath,
      socket: {
        data(socket) {
          socket.write(`{"id":"even","result":"${"x".repeat(64)}"}\n`);
        },
      },
    });
    try {
      const response = await call(unixTransport(socketPath, 64), "even", "pane.list");
      expect(response).toEqual({ error: { code: "transport" } });
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("ignores trailing data after a response frame when enforcing the buffer limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herdr-rpc-"));
    const socketPath = join(dir, "sock");
    const responseFrame = '{"id":"even","result":{"ok":true}}\n';
    const server = Bun.listen({
      unix: socketPath,
      socket: {
        data(socket) {
          socket.write(`${responseFrame}${"x".repeat(64)}`);
        },
      },
    });
    try {
      const maxResponseBytes = new TextEncoder().encode(responseFrame).byteLength;
      const response = await call(unixTransport(socketPath, maxResponseBytes), "even", "pane.list");
      expect(response).toEqual({ id: "even", result: { ok: true } });
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
