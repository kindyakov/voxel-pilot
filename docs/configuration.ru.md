# Конфигурация

Языковые версии: [English](configuration.md) | [Русский](configuration.ru.md)

Конфигурация валидируется в `packages/core/src/config/env.ts` через Ajv и потребляется в `packages/core/src/config/config.ts`.
Рекомендуемый способ задавать значения — `.env` на основе `.env.example`.

## Обязательные переменные

- `MINECRAFT_HOST`
- `MINECRAFT_PORT`
- `MINECRAFT_USERNAME`
- `MINECRAFT_VERSION`
- `AI_PROVIDER`
- `AI_MODEL`

## Значения AI-провайдера

`AI_PROVIDER` сейчас принимает:

- `openai`
- `routerai`
- `openrouter`
- `openai_compatible`
- `local`
- `disabled`

`local` и `disabled` не требуют `AI_API_KEY`.
Остальным провайдерам ключ нужен.

## Необязательные переменные

- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_TIMEOUT_MS`
- `AI_MAX_TOKENS`
- `LOG_LEVEL`
- `LOG_FILE`
- `MINECRAFT_VIEWER_PORT`
- `MINECRAFT_WEB_INVENTORY_PORT`

## Значения по умолчанию

- `AI_TIMEOUT_MS` по умолчанию `15000`
- `AI_MAX_TOKENS` по умолчанию `1000`
- `LOG_LEVEL` по умолчанию `info`
- `LOG_FILE` по умолчанию `logs/bot.log`
- `MINECRAFT_VIEWER_PORT` по умолчанию `3000`
- `MINECRAFT_WEB_INVENTORY_PORT` по умолчанию `3001`

## Заметки

- `Config.assertAIConfigured()` требует API-ключи только для не-локальных и не-отключённых провайдеров.
- Бот пишет постоянную память в `data/`, а логи — в `logs/`.
