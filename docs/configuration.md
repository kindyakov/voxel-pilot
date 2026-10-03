# Configuration

Language versions: [English](configuration.md) | [Русский](configuration.ru.md)

CLI and TUI explicitly load settings through `packages/application/src/settings.ts`; existing environment values override the selected file. Both use the same repository-root defaults and path overrides. Core validates the supplied snapshot through `packages/core/src/config/env.ts` and `packages/core/src/config/runtimeConfig.ts`. Public package imports do not load `.env`, create stores or start a connection.
The recommended way to set values is `.env` based on `.env.example`.

Runtime composition accepts `stopTimeoutMs` (default 10 seconds). CLI and TUI application composition accept `shutdownTimeoutMs` (default 15 seconds), covering runtime and logger close together; TUI also includes renderer/output cleanup. Both require a positive integer in the supported timer range. A deadline produces a nonzero exit and warns that persistence or cleanup may be incomplete. TUI retains final connection failure until explicit exit; CLI exits on retry exhaustion. TUI requests terminal restoration at its deadline, but a broken or blocked output stream cannot acknowledge that restoration.

`pnpm tui` requires interactive input/output and raw-input support; unsupported terminals are rejected before loading settings, with `pnpm start` offered for headless use. TUI collects DEBUG from the start while initially displaying INFO and above. Console logging is disabled to protect the dashboard; configured file thresholds and rotation remain independent.

## Required Variables

- `MINECRAFT_HOST`
- `MINECRAFT_PORT`
- `MINECRAFT_USERNAME`
- `MINECRAFT_VERSION`
- `AI_PROVIDER`
- `AI_MODEL`

## AI Provider Values

`AI_PROVIDER` currently accepts:

- `openai`
- `routerai`
- `openrouter`
- `openai_compatible`
- `local`
- `disabled`

`local` and `disabled` do not require `AI_API_KEY`.
Other providers do.

## Optional Variables

- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_TIMEOUT_MS`
- `AI_MAX_TOKENS`
- `LOG_LEVEL`
- `LOG_FILE`
- `MINECRAFT_VIEWER_PORT`
- `MINECRAFT_WEB_INVENTORY_PORT`

## Defaults

- `AI_TIMEOUT_MS` defaults to `15000`
- `AI_MAX_TOKENS` defaults to `1000`
- `LOG_LEVEL` defaults to `info`
- `LOG_FILE` defaults to `logs/bot.log`
- `MINECRAFT_VIEWER_PORT` defaults to `3000`
- `MINECRAFT_WEB_INVENTORY_PORT` defaults to `3001`

## Runtime Log History

`createBotRuntime(services, { logs })` configures the shared in-memory journal through composition options, independently of `LOG_LEVEL`, console output and file rotation. Its defaults are:

| Option          | Default           | Meaning                                                                                                                                     |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `level`         | `debug`           | Collection threshold; a display filter does not change collection.                                                                          |
| `maxEntries`    | `2000`            | Maximum retained source records.                                                                                                            |
| `maxBytes`      | `2097152` (2 MiB) | Sum of UTF-8 JSON bytes of retained safe entries, including entry fields and truncation markers. Snapshot envelope/statistics are excluded. |
| `maxEntryBytes` | `16384` (16 KiB)  | Maximum serialized entry; additionally capped by `maxBytes`.                                                                                |

Limits must be safe integers: `maxEntries` is positive and byte limits are at least 256 to fit the record envelope and marker. Oversized records carry a visible truncation marker and the original safe-message byte count. Oldest records are evicted until both history limits hold. Immutable history reports retained bytes, cumulative eviction/truncation totals, accepted counts per level and an independent revision. These are serialized payload limits, not a measurement of total JavaScript heap.

`runtime.telemetry.getLogHistory()` returns the current bounded history. `subscribeLogs` immediately supplies it, then safe append updates with an explicit disposer. Known configured credentials are redacted and disruptive control bytes escaped before shortening; raw prompts, stacks and runtime objects are excluded from metadata projection. A newer reentrant update can supersede older delivery; its history and cumulative counters support resynchronization. Completed stop/deadline releases log observers while retaining history; subscribe again after explicit restart for live updates. The app still closes its logger.

A terminal consumer selects `console:false` when creating its logger and keeps DEBUG collection from startup. File level/rotation remain independent. This journal does not enable request dumps, HSM heartbeat/inspection, viewer or inventory servers.

## Notes

- Runtime configuration validation only requires API keys for non-local, non-disabled providers.
- The bot writes persistent memory to `data/` and logs to `logs/`.
