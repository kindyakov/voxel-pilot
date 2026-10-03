# Contributing

Language versions: [English](CONTRIBUTING.md) | [Русский](CONTRIBUTING.ru.md)

This repository is public, but it is not a dumping ground for ad hoc changes. Keep contributions small, testable, and aligned with the existing architecture.

## Before You Open a PR

1. Read `AGENTS.md`, `ARCHITECTURE.md` and the implementation/callers/tests for the subsystem you are touching. Public docs under `docs/` provide user context.
2. Run `pnpm run type-check`.
3. Run `pnpm run build`.
4. Run `pnpm run check:imports` and the focused tests for the subsystem you changed. Use the pnpm version pinned by `packageManager` in `package.json`.

## Expectations

- Follow the existing TypeScript, XState, and Mineflayer conventions.
- Add or update tests when behavior changes.
- Do not introduce persistence shortcuts, hidden global state, or logic that bypasses the HSM.
- Keep changes scoped to the subsystem they belong to.
- Treat the code and tests as the source of truth when docs disagree.

## Repository Layout

- Runtime and native tests: `packages/core/src/`, `packages/core/src/tests/`
- Portable contracts and presentation: `packages/contracts/`, `packages/presentation/`
- Shared explicit application composition: `packages/application/`
- Headless CLI and terminal dashboard: `apps/cli/`, `apps/tui/` (tests under each `src/tests/`)
- Workspace/import/browser checks: `tests/`
- Documentation: `docs/`
- Runtime memory: `data/`
- Logs: `logs/`

## Pull Requests

Use the PR template in `.github/PULL_REQUEST_TEMPLATE.md` and include:

- a short summary
- the behavioral change
- verification steps
- any follow-up risks
