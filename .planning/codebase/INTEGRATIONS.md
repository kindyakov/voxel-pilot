# External Integrations

> **Focus:** tech
> **Generated:** 2026-04-06
> **Codebase:** voxel-pilot

## APIs & External Services

**LLM Providers:**

- OpenAI API - Primary AI provider, used via Responses API (`src/ai/client.ts` → `OpenAIResponsesClient`)
  - SDK: `openai` 6.32.0
  - Auth: `AI_API_KEY` env var
  - Model: configured via `AI_MODEL` (default: `gpt-4.1-mini`)
  - Timeout: `AI_TIMEOUT_MS` (default: 15000ms)
  - Max tokens: `AI_MAX_TOKENS` (default: 1000)

- OpenRouter / OpenAI-Compatible APIs - Alternative providers via Chat Completions API (`src/ai/client.ts` → `OpenAICompatibleChatClient`)
  - Providers: `openrouter`, `openai_compatible`, `routerai`
  - Auth: `AI_API_KEY` env var
  - Base URL: `AI_BASE_URL` env var (for custom endpoints)
  - Same timeout and max token config

**Minecraft Server:**

- Direct TCP connection via Mineflayer protocol client
  - Host: `MINECRAFT_HOST` (default: `localhost`)
  - Port: `MINECRAFT_PORT` (default: `25565`)
  - Version: `MINECRAFT_VERSION` (default: `1.20.4`)
  - Username: `MINECRAFT_USERNAME` (default: `minecraft-bot`)
  - Connection management: `src/modules/connection/index.ts`

## Data Storage

**Databases:**

- SQLite (via `better-sqlite3` 12.8.0)
  - Location: `data/bot_memory_<username>.db`
  - Client: `better-sqlite3` synchronous API
  - Schema: `src/core/memory/index.ts` defines two tables:
    - `memory_entries` - Persistent world knowledge (type, position, tags, description, JSON data)
    - `memory_meta` - Bot metadata (name, version, timestamps)
  - DB version: `2.0.0`
  - Schema management: `initializeSchema()` creates tables if not exist (no migrations yet)

**File Storage:**

- Local filesystem only
  - `data/` - SQLite database files
  - `logs/` - Winston log files (rotated, 10MB max, 5 files)

**Caching:**

- None. In-memory state managed by XState machine context (`src/hsm/context.ts`) and `MemoryManager` runtime state.

## Authentication & Identity

**Auth Provider:**

- Minecraft server authentication (offline/cracked or Mojang/Microsoft via Mineflayer)
  - Implementation: Mineflayer's `createBot()` handles auth based on server configuration
  - No custom auth layer; bot authenticates as a standard Minecraft client

**AI API Authentication:**

- API key passed directly to OpenAI SDK constructor
  - Key sourced from `AI_API_KEY` env var
  - Validated at startup in `Config.assertAIConfigured()` (`src/config/config.ts`)

## Monitoring & Observability

**Error Tracking:**

- None (no Sentry, no external error tracking)
- Errors logged locally via Winston

**Logs:**

- Winston logger (`src/config/logger.ts`)
  - Console transport (colorized in development, level from `LOG_LEVEL`)
  - File transport: `logs/bot.log` (10MB rotation, 5 files)
  - Error-only file: `logs/error.log` (10MB rotation, 5 files)
  - Correlation ID support for request tracing
  - Structured log methods: `botAction()`, `playerCommand()`, `aiCall()`, `exception()`
  - Log levels: `debug`, `info`, `warn`, `error`

**HSM State Logging:**

- Console.log-based state entry/exit logging in `src/hsm/machine.ts`
  - `[HSM] enter/exit` with state name, event type, target entity ID, distance
  - `[AI] thinking_start`, `[AI] thinking_done`, `[AI] thinking_error` for agent loop observability

## CI/CD & Deployment

**Hosting:**

- Self-hosted (runs as a Node.js process)
- No cloud deployment configuration detected

**CI Pipeline:**

- None detected (no GitHub Actions workflows beyond issue/PR templates)
- `.github/` contains only `ISSUE_TEMPLATE/` and `PULL_REQUEST_TEMPLATE.md`

## Environment Configuration

**Required env vars:**

```
MINECRAFT_HOST       # Server hostname (required)
MINECRAFT_PORT       # Server port (required, numeric)
MINECRAFT_USERNAME   # Bot username (required)
MINECRAFT_VERSION    # Minecraft version (required, e.g. "1.20.4")
AI_PROVIDER          # AI provider enum (required): openai|routerai|openrouter|openai_compatible|local|disabled
AI_MODEL             # Model name (required, e.g. "gpt-4.1-mini")
```

**Optional env vars:**

```
AI_API_KEY           # API key (required unless provider is "disabled" or "local")
AI_BASE_URL          # Custom API endpoint URL
AI_TIMEOUT_MS        # Request timeout in ms (default: 15000)
AI_MAX_TOKENS        # Max response tokens (default: 1000)
LOG_LEVEL            # Winston log level (default: "info")
LOG_FILE             # Log file path (default: "logs/bot.log")
MINECRAFT_VIEWER_PORT        # Prismarine viewer port (default: 3000)
MINECRAFT_WEB_INVENTORY_PORT # Web inventory port (default: 3001)
NODE_ENV             # "development" or "production" (affects log level)
```

**Secrets location:**

- Local `.env` file (gitignored)
- `.env.example` provides template without values

## Webhooks & Callbacks

**Incoming:**

- None. The bot does not expose any HTTP endpoints or accept webhooks.

**Outgoing:**

- None. The bot does not send webhooks to external services.

## Mineflayer Plugin Integrations

Plugins are loaded in `src/modules/plugins/index.plugins.ts` and registered in `src/modules/connection/index.ts`:

| Plugin       | File                                  | Purpose                             |
| ------------ | ------------------------------------- | ----------------------------------- |
| pathfinder   | `src/modules/plugins/pathfinder.ts`   | A\* navigation, movement goals      |
| pvp          | `src/modules/plugins/pvp.ts`          | Combat automation (melee + ranged)  |
| armorManager | `src/modules/plugins/armorManager.ts` | Auto-equip best armor               |
| autoEat      | `src/modules/plugins/autoEat.ts`      | Auto-consume food when hungry       |
| tool         | `src/modules/plugins/tool.ts`         | Optimal tool selection for mining   |
| movement     | `src/modules/plugins/movement.ts`     | Micro-movement controller           |
| hawkeye      | `src/modules/plugins/hawkeye.ts`      | Ranged combat aiming                |
| viewer       | `src/modules/plugins/viewer.ts`       | 3D web viewer (`prismarine-viewer`) |
| webInventory | `src/modules/plugins/webInventory.ts` | Web-based inventory viewer          |
| goals        | `src/modules/plugins/goals.ts`        | Goal tracking plugin                |

## AI Agent Tool Integration

The bot exposes 16 agent tools to the LLM (`src/ai/tools.ts`), categorized as:

**Inline tools** (execute within thinking phase):

- `memory_save`, `memory_read`, `memory_update_data`, `memory_delete` - SQLite-backed persistent memory
- `inspect_inventory`, `inspect_blocks`, `inspect_entities`, `inspect_window` - World state inspection

**Execution tools** (trigger HSM state transitions):

- `navigate_to`, `break_block`, `place_block`, `follow_entity` - Movement and interaction
- `open_window`, `transfer_item`, `close_window` - Container interactions

**Control tools:**

- `finish_goal` - Signals goal completion to the agent loop

---

_Integration audit: 2026-04-06_
