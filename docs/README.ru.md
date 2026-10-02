# Документация

Языковые версии: [English](README.md) | [Русский](README.ru.md)

Здесь лежит актуальная, сверенная с кодом документация проекта.
При споре доки с `packages/core/src/` или тестами прав код.

## Начни отсюда

- [Архитектура](architecture.ru.md) / [Architecture](architecture.md)
- [Конфигурация](configuration.md)
- [Память](memory-guide.md)
- [Combat visibility](enemy-visibility-system.md)

## Заметки по агентскому рантайму

Короткие русскоязычные заметки, фиксирующие текущую границу агентского рантайма. Это активный контекст, не история:

- [Сужение snapshot и переход к inspect-tools](tasks/сужение-snapshot-и-переход-к-inspect-tools.md)
- [Grounded plain-text fallback для agent loop](tasks/grounded-plain-text-fallback-для-agent-loop.md)
- [Agent runtime next steps](tasks/agent-runtime-next-steps.md)

## Диаграммы

- `diagrams/xstate-machine.drawio` — структурный скетч машины. Секция боя ещё показывает удалённый стейт `APPROACHING`; при споре верь `packages/core/src/hsm/machine.ts` (`DECIDING -> MELEE_ATTACKING | RANGED_SKIRMISHING`).
