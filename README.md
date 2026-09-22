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

`bun run check` formats and lints the repository, checks types, and runs tests. It also builds a bundle and a standalone binary for every plugin, then verifies that each binary fails when `HERDR_SOCKET_PATH` is unset.

## Layout

```text
packages/herdr-runtime/   shared JSON-RPC, pane notes, coalescing, plugin host
plugins/<plugin-id>/      herdr-plugin.toml, ./plugin, TypeScript sources
```

`./plugin` in a plugin directory is the Herdr command. A source checkout runs it with Bun.

## Link a local source tree

```sh
herdr plugin link ./plugins/herdr-even-layout --enabled
```

## Build outputs

- `bun run build` writes `dist/<plugin-id>/plugin.js` for every plugin.
- `bun run build:standalone` writes `dist/<plugin-id>/plugin` for every plugin on the current host.

## Add a plugin

1. Create `plugins/<plugin-id>/` with `herdr-plugin.toml`, a `./plugin` launcher, and `src/main.ts`. Copy `./plugin` from an existing plugin.
2. Start `src/main.ts` with `createPluginLog`, `requiredEnv`, `createHost`, and `runPlugin` from `packages/herdr-runtime`. Use the runtime for socket RPC, pane notes, and coalescing. Keep event routing and plugin behavior in the plugin.
3. Build, signing, smoke tests, shfmt, and ShellCheck discover `plugins/*/herdr-plugin.toml`. Do not add the plugin id to `package.json`.
4. Keep unit tests next to the modules they cover.

## Versioning

Bump `version` in that plugin's `herdr-plugin.toml`. After publishing the repository to GitHub, consumers can use `github:5n7/herdr-plugins` instead of a local path. Tag a standalone plugin release as `<plugin-id>-v<version>`.
