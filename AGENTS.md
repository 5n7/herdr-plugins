# Agent notes

## Setup

Use mise to install Bun, shfmt, and ShellCheck. Do not define mise tasks. Package scripts use `mise exec` only to select the managed shell tools.

In a fresh checkout, run:

```sh
mise install
bun install --frozen-lockfile
```

## Before completion

Run `bun run check`. It formats and lints the repository, checks types, runs tests, builds both artifacts, and verifies that the standalone binary fails when `HERDR_SOCKET_PATH` is unset.

TypeScript plugins talk to Herdr through `packages/herdr-runtime`. Keep layout math and event routing free of sockets and the filesystem so `bun test` stays deterministic.

Keep generated files out of Git. `dist/` holds local release binaries.
