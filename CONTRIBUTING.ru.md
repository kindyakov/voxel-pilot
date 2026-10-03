# Вклад в проект

Языковые версии: [English](CONTRIBUTING.md) | [Русский](CONTRIBUTING.ru.md)

Этот репозиторий публичный, но это не место для случайных правок. Изменения должны быть небольшими, проверяемыми и согласованными с существующей архитектурой.

## Перед открытием PR

1. Прочитайте `AGENTS.md`, `ARCHITECTURE.md`, реализацию, вызывающий код и тесты подсистемы. Публичные docs в `docs/` дают пользовательский контекст.
2. Запустите `pnpm run type-check`.
3. Запустите `pnpm run build`.
4. Запустите `pnpm run check:imports` и focused tests затронутой подсистемы. Используйте версию pnpm из `packageManager` в `package.json`.

## Ожидания

- Следуйте существующим соглашениям TypeScript, XState и Mineflayer.
- Обновляйте тесты, если меняется поведение.
- Не вводите обходные пути для persistence, скрытое глобальное состояние или логику, обходящую HSM.
- Держите изменения в рамках той подсистемы, к которой они относятся.
- Если документация и код расходятся, источником истины считаются код и тесты.

## Структура репозитория

- Runtime и native tests: `packages/core/src/`, `packages/core/src/tests/`
- Переносимые contracts и presentation: `packages/contracts/`, `packages/presentation/`
- Общая явная application composition: `packages/application/`
- Headless CLI и дашборд: `apps/cli/`, `apps/tui/` (тесты в их `src/tests/`)
- Workspace/import/browser checks: `tests/`
- Documentation: `docs/`
- Runtime memory: `data/`
- Logs: `logs/`

## Pull Request

Используйте шаблон PR в `.github/PULL_REQUEST_TEMPLATE.md` и укажите:

- краткое описание
- изменение поведения
- шаги проверки
- любые риски или follow-up
