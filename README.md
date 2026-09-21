# herdr-plugins

Herdr plugins. `herdr-even-layout` equalizes pane widths and heights after splits.

## Start here

Run these commands once in a fresh checkout:

```sh
mise install
bun install --frozen-lockfile
```

mise installs the pinned Bun, shfmt, and ShellCheck executables. Bun installs the project's development dependencies.

```sh
bun run check
```

`bun run check` formats and lints the repository, checks types, and runs tests. It also builds the bundle and standalone binary, then verifies that the standalone binary fails when `HERDR_SOCKET_PATH` is unset.

## Layout

```text
packages/herdr-runtime/   shared JSON-RPC, pane notes, coalescing
plugins/<plugin-id>/      herdr-plugin.toml, ./plugin, TypeScript sources
```

`./plugin` in a plugin directory is the Herdr command. A source checkout runs it with Bun.

## Link a local source tree

```sh
herdr plugin link ./plugins/herdr-even-layout --enabled
```

## Build outputs

- `bun run build` writes `dist/herdr-even-layout/plugin.js`.
- `bun run build:standalone` writes `dist/herdr-even-layout/plugin` for release testing on the current host.

## Add a plugin

1. Create `plugins/<plugin-id>/` with a checked-in `herdr-plugin.toml` and `src/`.
2. Reuse `packages/herdr-runtime` for socket RPC, pane notes, or coalescing.
3. Add Bun build scripts when the plugin needs a distributable bundle or standalone binary.
4. Keep unit tests next to the modules they cover.

## Versioning

Bump `version` in that plugin's `herdr-plugin.toml`. After publishing the repository to GitHub, consumers can use `github:5n7/herdr-plugins` instead of a local path. Tag a standalone plugin release as `<plugin-id>-v<version>`.
