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

- Node.js 24 or newer (built-in `node:sqlite` storage, no native build tools required).
- A Minecraft server you control or are explicitly allowed to use.
- An AI provider and model if `AI_PROVIDER` is not `local` or `disabled`.

## Quick Start

1. Install dependencies.

   ```bash
   npm install
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
   npm run dev
   ```

5. Build for production if needed.

   ```bash
   npm run build
   npm start
   ```

## Configuration

Required variables:

| Variable | Purpose |
| --- | --- |
| `MINECRAFT_HOST` | Minecraft server host |
| `MINECRAFT_PORT` | Minecraft server port |
| `MINECRAFT_USERNAME` | Bot username |
| `MINECRAFT_VERSION` | Minecraft protocol version |
| `AI_PROVIDER` | Provider name: `openai`, `routerai`, `openrouter`, `openai_compatible`, `local`, or `disabled` |
| `AI_MODEL` | Model name used by the selected provider |

Common optional variables:

| Variable | Purpose |
| --- | --- |
| `AI_BASE_URL` | Base URL for OpenAI-compatible providers |
| `AI_API_KEY` | API key for the selected provider |
| `AI_TIMEOUT_MS` | Request timeout in milliseconds |
| `AI_MAX_TOKENS` | Maximum completion tokens |
| `LOG_LEVEL` | Logging level, defaults to `info` |
| `LOG_FILE` | Log file path, defaults to `logs/bot.log` |
| `MINECRAFT_VIEWER_PORT` | Port for the optional viewer plugin |
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
npm run dev
npm run build
npm run type-check
npm run format
npm run clean
```

## Safety Notes

- Do not point the bot at servers you do not control or have permission to automate.
- Treat the bot as stateful infrastructure: it writes logs and persistent memory to disk.
- Review `data/` and `logs/` before committing or publishing artifacts.

## Contributing

Before opening a pull request:

1. Run `npm run type-check`.
2. Run `npm run build`.
3. Run the relevant focused tests under `src/tests/`.
4. Keep changes aligned with the existing architecture and naming conventions.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## License

Licensed under the ISC License. See [LICENSE](LICENSE).
