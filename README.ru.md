# VoxelPilot

Языковые версии: [English](README.md) | [Русский](README.ru.md)

VoxelPilot - AI-бот для Minecraft на базе Mineflayer и XState. Бот подключается к серверу, строит детерминированный снимок состояния мира, запрашивает у модели одно следующее действие и выполняет его через иерархический автомат состояний.

## Что делает

- Подключается к Minecraft-серверу и реагирует на чат-команды игроков.
- Использует AI-loop для выбора между памятью, инспекцией контейнеров, завершением цели и одним исполнительным действием.
- Выполняет действия через примитивы: navigation, breaking, crafting, smelting, placing и follow.
- Хранит долгосрочную память в SQLite в каталоге `data/`.

## Быстрый старт

1. Установите зависимости.
2. Скопируйте `.env.example` в `.env`.
3. Заполните `MINECRAFT_*` и `AI_*`.
4. Запустите `npm run dev`.

## Конфигурация

Подробный список переменных окружения находится в [docs/configuration.md](docs/configuration.md).

## Документация

- [Индекс документации](docs/README.md)
- [Архитектура](docs/architecture.md)
- [Конфигурация](docs/configuration.md)
- [Память](docs/memory-guide.md)
- [Combat visibility](docs/enemy-visibility-system.md)

Если документация и код расходятся, источником истины считаются код и тесты.

## Разработка

Полезные команды:

- `npm run dev`
- `npm run build`
- `npm run type-check`
- `npm run format`
- `npm run clean`

## Безопасность

- Не подключайте бота к серверам, которыми вы не управляете и на которые у вас нет разрешения.
- Бот пишет логи и persistent memory на диск.
- Перед публикацией проверяйте `data/` и `logs/`.

## Вклад

См. [CONTRIBUTING.ru.md](CONTRIBUTING.ru.md).

## Лицензия

Проект распространяется по лицензии ISC. См. [LICENSE](LICENSE).
