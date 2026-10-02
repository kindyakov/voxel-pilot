# Documentation

Language versions: [English](README.md) | [Русский](README.ru.md)

This folder contains the current, code-aligned documentation for the project.
If a doc conflicts with `packages/core/src/` or tests, the code wins.

## Start Here

- [Architecture](architecture.md) / [Архитектура](architecture.ru.md)
- [Configuration](configuration.md)
- [Memory](memory-guide.md)
- [Combat visibility](enemy-visibility-system.md)

## Agent Runtime Design Notes

Short-lived Russian-language notes that pin down the current agent-runtime boundary. They are part of the active context, not history:

- [Сужение snapshot и переход к inspect-tools](tasks/сужение-snapshot-и-переход-к-inspect-tools.md)
- [Grounded plain-text fallback для agent loop](tasks/grounded-plain-text-fallback-для-agent-loop.md)
- [Agent runtime next steps](tasks/agent-runtime-next-steps.md)

## Diagrams

- `diagrams/xstate-machine.drawio` — structural sketch of the machine. The combat section still shows the removed `APPROACHING` state; trust `packages/core/src/hsm/machine.ts` (`DECIDING -> MELEE_ATTACKING | RANGED_SKIRMISHING`) when they disagree.
