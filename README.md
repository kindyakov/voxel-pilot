# VoxelPilot

Language versions: [English](README.md) | [Русский](README.ru.md)

VoxelPilot is an autonomous Minecraft bot harness with an optional AI pilot. Built with [mineflayer](https://github.com/PrismarineJS/mineflayer) and [XState](https://stately.ai/docs/xstate), it connects to a Minecraft server and runs a hierarchical state machine that lives independently of LLM availability. The AI/LLM acts as a pilot: with it, the bot solves complex tasks autonomously; without it, the harness keeps surviving, monitoring, and self-defending while rejecting new goals and preserving `:stop`.

## What It Does

- Connects to a Minecraft server and exposes bot state through a structured control loop.
- Uses an optional AI pilot to choose between informational and execution tools; without AI the bot lives autonomously (monitoring, tactical retreat, eating from inventory, self-defense, idle gaze).
- Runs physical actions through isolated primitives such as navigating, breaking, crafting, and smelting.
- Persists long-term memory in SQLite under `data/`.
- Supports optional plugins for pathfinding, combat, auto-eating, inventory viewing, and more.
- Survives AI/network failures: active goals are paused (not cleared) and resumed when AI returns.

## Requirements

- pnpm at the version pinned in `package.json` (`packageManager`).
- Node.js 24 or newer (built-in `node:sqlite` storage, no native build tools required).
- A Minecraft server you control or are explicitly allowed to use.
- An AI provider and model if `AI_PROVIDER` is not `local` or `disabled`.

## Quick Start

1. Install dependencies.

   ```bash
   pnpm install --frozen-lockfile
   ```

2. Create your environment file.

   ```bash
   cp .env.example .env
   ```

   On PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Fill in the required values in `.env`.
4. Start the bot in development mode.

   ```bash
   pnpm run dev
   ```

5. Build for production if needed.

   ```bash
   pnpm run build
   pnpm start
   ```

## Terminal dashboard

After configuring the same `.env` and running `pnpm run build`, use `pnpm run tui` in an interactive terminal. The dashboard starts one bot, shows connection state and an INFO+ journal, and keeps a final connection failure visible until exit. DEBUG is collected from startup; console logging is disabled while file logging keeps its own configured level. CLI and TUI use the same repository data and log paths when run sequentially.

The status panel shows measured health/maxHealth, food, coordinates, MAIN_ACTIVITY and its elapsed time, current action, independent monitoring and the active or paused goal. Unknown values appear as `—`; real zero stays zero. Stale measurements are marked, including the time since entry into the last known state. A new session clears old measurements until fresh observations arrive; monitoring and log updates do not reset the main-state timer.

Press `d` to show retained DEBUG records. Up/Down and PgUp/PgDn browse records; scrolling up pauses the view while a badge counts new matching events. `End` or scrolling down to the latest record returns to LIVE. Filtering and resizing keep the paused source anchor; eviction shows a loss notice and the earliest retained matching record. Journal eviction and source truncation remain visible, and shortened display text uses an ellipsis.

Use `q` or Ctrl+C to stop and await persistence. Signals and application failures join the same bounded shutdown; a deadline or failed save exits nonzero. The terminal needs interactive input/output and raw input support. Unsupported terminals are rejected before settings/resource allocation; use `pnpm start` for the headless CLI. `pnpm run dev:tui` provides the development watcher.

At 120 columns or more, the journal and status use approximately 65/35 of the content width. Narrower windows stack compact status above the journal; insufficient space shows an enlargement notice while input and the bot keep running. Page keys use the number of displayed records. Resizing preserves the filter, pause anchor and elapsed main-state time. Long text is clipped by terminal cells; `[усечено]` (or `[!]`/`!`) marks source truncation separately from display shortening.

Display styling follows TTY color capabilities and terminal hints. `NO_COLOR` or `FORCE_COLOR=0` disables colors; `TERM=dumb`, `TERM=linux` or an explicitly non-UTF8 locale simplifies decorative symbols to ASCII. Limited displays keep textual levels, unknown/stale values and paused goals; shortened text uses `~`. CLI remains the headless Docker default.

## Docker

One bot per container. Build once, then run with your `.env` and persistent volumes:

```bash
docker build -t voxel-pilot .
docker compose up -d --build
```

`compose.yaml` wires `.env`, `./data` and `./logs` volumes, viewer/inventory ports (`3000`/`3001`) and restart policy. For more bots, duplicate the service with its own name, `.env` file and volumes.

## Configuration

Required variables:

| Variable             | Purpose                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `MINECRAFT_HOST`     | Minecraft server host                                                                          |
| `MINECRAFT_PORT`     | Minecraft server port                                                                          |
| `MINECRAFT_USERNAME` | Bot username                                                                                   |
| `MINECRAFT_VERSION`  | Minecraft protocol version                                                                     |
| `AI_PROVIDER`        | Provider name: `openai`, `routerai`, `openrouter`, `openai_compatible`, `local`, or `disabled` |
| `AI_MODEL`           | Model name used by the selected provider                                                       |

Common optional variables:

| Variable                       | Purpose                                    |
| ------------------------------ | ------------------------------------------ |
| `AI_BASE_URL`                  | Base URL for OpenAI-compatible providers   |
| `AI_API_KEY`                   | API key for the selected provider          |
| `AI_TIMEOUT_MS`                | Request timeout in milliseconds            |
| `AI_MAX_TOKENS`                | Maximum completion tokens                  |
| `LOG_LEVEL`                    | Logging level, defaults to `info`          |
| `LOG_FILE`                     | Log file path, defaults to `logs/bot.log`  |
| `MINECRAFT_VIEWER_PORT`        | Port for the optional viewer plugin        |
| `MINECRAFT_WEB_INVENTORY_PORT` | Port for the optional web inventory plugin |

## Architecture

The bot is structured around a parallel XState machine:

- `MAIN_ACTIVITY` handles idle, urgent needs, combat, and task execution.
- `MONITORING` tracks background conditions.
- `TASKS` uses an `IDLE -> THINKING -> EXECUTING` loop.

The AI loop is deterministic on the input side:

- snapshot generation happens before model calls
- informational tools run inline
- execution tools transition into concrete primitives
- failures feed back into the machine context instead of disappearing

Documentation:

- [Docs index](docs/README.md)
- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [Memory](docs/memory-guide.md)
- [Combat visibility](docs/enemy-visibility-system.md)

If a doc conflicts with code or tests, the code wins.

## Development

Useful commands:

```bash
pnpm run dev
pnpm run build
pnpm run check:imports
pnpm run type-check
pnpm test
pnpm run format
pnpm run clean
```

## Safety Notes

- Do not point the bot at servers you do not control or have permission to automate.
- Treat the bot as stateful infrastructure: it writes logs and persistent memory to disk.
- Review `data/` and `logs/` before committing or publishing artifacts.

## Contributing

Before opening a pull request:

1. Run `pnpm run type-check`.
2. Run `pnpm run build`.
3. Run the relevant focused tests under `packages/core/src/tests/` using `pnpm --filter @voxel-pilot/core exec tsx --import ./src/tests/setupEnv.mjs --test <paths relative to packages/core>`.
4. Keep changes aligned with the existing architecture and naming conventions.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## License

Licensed under the ISC License. See [LICENSE](LICENSE).
