# Minecraft Bot AI

Языковые версии: [English](README.md) | [Русский](README.ru.md)

AI-управляемый Minecraft-бот на [mineflayer](https://github.com/PrismarineJS/mineflayer) и [XState](https://stately.ai/docs/xstate). Он подключается к Minecraft-серверу, строит детерминированный снимок состояния мира, запрашивает у LLM следующее решение по инструменту и выполняет действие через иерархический автомат состояний.

## Что делает

- Подключается к Minecraft-серверу и выводит состояние бота через структурированный цикл управления.
- Использует AI-цикл для выбора между информационными и исполнительными инструментами.
- Выполняет физические действия через изолированные примитивы: навигацию, добычу, крафт и плавку.
- Хранит долгосрочную память в SQLite в каталоге `data/`.
- Поддерживает дополнительные плагины для pathfinding, combat, auto-eat, просмотра инвентаря и других задач.

## Требования

- Node.js 18 или новее.
- Minecraft-сервер, которым вы управляете или на использование которого у вас есть разрешение.
- AI-провайдер и модель, если `AI_PROVIDER` не равен `local` или `disabled`.
- Нативные инструменты сборки, необходимые для `better-sqlite3` на вашей платформе.

## Быстрый старт

1. Установите зависимости.

   ```bash
   npm install
   ```

2. Создайте файл окружения.

   ```bash
   cp .env.example .env
   ```

   В PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Заполните обязательные значения в `.env`.
4. Запустите бота в режиме разработки.

   ```bash
   npm run dev
   ```

5. При необходимости соберите production-версию.

   ```bash
   npm run build
   npm start
   ```

## Конфигурация

Обязательные переменные:

| Переменная | Назначение |
| --- | --- |
| `MINECRAFT_HOST` | Хост Minecraft-сервера |
| `MINECRAFT_PORT` | Порт Minecraft-сервера |
| `MINECRAFT_USERNAME` | Имя пользователя бота |
| `MINECRAFT_VERSION` | Версия протокола Minecraft |
| `AI_PROVIDER` | Имя провайдера: `openai`, `routerai`, `openrouter`, `openai_compatible`, `local` или `disabled` |
| `AI_MODEL` | Имя модели, используемой выбранным провайдером |

Часто используемые необязательные переменные:

| Переменная | Назначение |
| --- | --- |
| `AI_BASE_URL` | Базовый URL для OpenAI-compatible провайдеров |
| `AI_API_KEY` | API-ключ выбранного провайдера |
| `AI_TIMEOUT_MS` | Таймаут запроса в миллисекундах |
| `AI_MAX_TOKENS` | Максимальное число токенов ответа |
| `LOG_LEVEL` | Уровень логирования, по умолчанию `info` |
| `LOG_FILE` | Путь к файлу логов, по умолчанию `logs/bot.log` |
| `MINECRAFT_VIEWER_PORT` | Порт для опционального viewer-плагина |
| `MINECRAFT_WEB_INVENTORY_PORT` | Порт для опционального web inventory-плагина |

## Архитектура

Бот построен вокруг параллельного автомата XState:

- `MAIN_ACTIVITY` обрабатывает idle, urgent needs, combat и выполнение задач.
- `MONITORING` отслеживает фоновые условия.
- `TASKS` использует цикл `IDLE -> THINKING -> EXECUTING`.

AI-цикл детерминирован на входе:

- сначала строится snapshot состояния
- информационные инструменты выполняются inline
- исполнительные инструменты переводят систему в конкретные примитивы
- ошибки возвращаются в контекст машины, а не теряются

Подробности архитектуры:

- [Architecture overview](docs/architecture.md)
- [Task workflow](docs/tasks-guide.md)
- [Primitive reference](docs/primitives-guide.md)
- [Memory guide](docs/memory-guide.md)
- [Validation guide](docs/validation-guide.md)

## Разработка

Полезные команды:

```bash
npm run dev
npm run build
npm run type-check
npm run format
npm run clean
```

## Безопасность

- Не подключайте бота к серверам, которыми вы не управляете и на использование которых у вас нет разрешения.
- Бот хранит состояние на диске: логи и persistent memory пишутся локально.
- Перед публикацией проверьте каталоги `data/` и `logs/`.

## Вклад

Перед открытием pull request:

1. Запустите `npm run type-check`.
2. Запустите `npm run build`.
3. Прогоните релевантные focused tests из `src/tests/`.
4. Держите изменения в рамках существующей архитектуры и соглашений по именованию.

Полный процесс описан в [CONTRIBUTING.md](CONTRIBUTING.md).

## Лицензия

Проект распространяется по лицензии ISC. См. [LICENSE](LICENSE).
