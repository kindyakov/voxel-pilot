# Configuration

Configuration is validated in `src/config/env.ts` with Ajv and consumed in `src/config/config.ts`.
The recommended way to set values is `.env` based on `.env.example`.

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

## Notes

- `Config.assertAIConfigured()` only enforces API keys for non-local, non-disabled providers.
- The bot writes persistent memory to `data/` and logs to `logs/`.
