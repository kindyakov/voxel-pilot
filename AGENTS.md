# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the application code. `src/index.ts` is the runtime entrypoint, `src/core/` owns bot startup, connection lifecycle, memory, and command handling, and `src/hsm/` contains the XState state machine split into `actions/`, `actors/`, `guards/`, `tasks/`, and `primitives/`. Plugin wiring lives in `src/modules/`, shared helpers in `src/utils/`, config in `src/config/`, and shared typings in `src/types/`. Keep generated output in `dist/`, persisted bot state in `data/`, runtime logs in `logs/`, and architecture notes in `docs/`.

## Build, Test, and Development Commands
Use Node 18+.

- `npm run dev`: run the bot with `tsx watch` against `src/index.ts`.
- `npm run build`: compile TypeScript to `dist/` and rewrite path aliases with `tsc-alias`.
- `npm start`: run the compiled bot from `dist/index.js`.
- `npm run type-check`: strict TypeScript validation without emitting files.
- `npm run knip`: detect unused files, exports, and dependencies.
- `npm run clean`: remove `dist/` before a fresh build.

Run `npm run type-check && npm run build` before opening a PR.

## Coding Style & Naming Conventions
Formatting is defined by [`.prettierrc`](/D:/Developer/Minecraft_bot/.prettierrc): tabs, visual width 2, no semicolons, single quotes, and ES module syntax. Prefer the configured path aliases such as `@core/*`, `@hsm/*`, and `@utils/*` over long relative imports. Follow existing naming patterns: classes in PascalCase, functions and variables in camelCase, and domain files with suffixes like `*.guards.ts`, `*.actors.ts`, `*.entry.ts`, `*.exit.ts`, and `*.primitive.ts`.

## Testing Guidelines
There is no dedicated automated test runner configured in `package.json` yet. Treat `npm run type-check`, `npm run build`, and an observed local bot session as the minimum validation bar. Put new automated tests in `src/tests/` when you add a runner, and name them after the unit or behavior under test, for example `enemyVisibility.test.ts`. If a change is hard to automate, document the manual verification steps in `docs/`.

## Commit & Pull Request Guidelines
Recent history uses short prefixed subjects such as `feat:` and `задача:`. Keep that convention, write imperative summaries, and avoid meaningless commit messages. Each PR should state the affected subsystem, describe behavioral changes, list validation steps, and link the relevant issue or task. Include logs or screenshots only when the change affects Prismarine Viewer or web inventory.

## Security & Configuration Tips
Start from [`.env.example`](/D:/Developer/Minecraft_bot/.env.example) and keep secrets in a local `.env` only. Never commit credentials, live server addresses, or generated log files. Review `data/` and `logs/` before committing to avoid leaking runtime state.
