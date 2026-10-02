# Конфигурация

Языковые версии: [English](configuration.md) | [Русский](configuration.ru.md)

CLI явно загружает настройки в `apps/cli/src/settings.ts`; заданные значения окружения имеют приоритет над выбранным файлом. Ядро проверяет переданный снимок через `packages/core/src/config/env.ts` и `packages/core/src/config/runtimeConfig.ts`. Импорт ядра не читает `.env` и не создаёт вывод.
Рекомендуемый способ задавать значения — `.env` на основе `.env.example`.

Композиция runtime принимает `stopTimeoutMs` (по умолчанию 10 секунд). Композиция CLI принимает `shutdownTimeoutMs` (по умолчанию 15 секунд), ограничивающий остановку runtime и закрытие логгера вместе. Оба параметра — положительные целые числа в допустимом диапазоне таймера. Превышение даёт ненулевой код выхода и сообщение о возможном неполном сохранении или очистке; исчерпание реконнекта тоже завершается ошибкой. Показатели переносимого runtime остаются неизвестными до реализации адаптеров наблюдения.

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
