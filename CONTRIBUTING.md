# Contributing

Language versions: [English](CONTRIBUTING.md) | [Русский](CONTRIBUTING.ru.md)

This repository is public, but it is not a dumping ground for ad hoc changes. Keep contributions small, testable, and aligned with the existing architecture.

## Before You Open a PR

1. Read the relevant docs under `docs/` for the subsystem you are touching.
2. Run `npm run type-check`.
3. Run `npm run build`.
4. Run the focused tests for the subsystem you changed.

## Expectations

- Follow the existing TypeScript, XState, and Mineflayer conventions.
- Add or update tests when behavior changes.
- Do not introduce persistence shortcuts, hidden global state, or logic that bypasses the HSM.
- Keep changes scoped to the subsystem they belong to.
- Treat the code and tests as the source of truth when docs disagree.

## Repository Layout

- Runtime code: `src/`
- Tests: `src/tests/`
- Documentation: `docs/`
- Runtime memory: `data/`
- Logs: `logs/`

## Pull Requests

Use the PR template in `.github/PULL_REQUEST_TEMPLATE.md` and include:

- a short summary
- the behavioral change
- verification steps
- any follow-up risks
