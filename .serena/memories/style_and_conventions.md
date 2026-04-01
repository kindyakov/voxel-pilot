# Style And Conventions

## Language and Formatting
- TypeScript project using ESM
- Prettier config uses tabs, tab width 2, no semicolons, single quotes, JSX single quotes, and no trailing commas
- Imports are sorted via `@trivago/prettier-plugin-sort-imports`

## Imports
- Prefer path aliases such as `@/core/*`, `@/hsm/*`, `@/utils/*`, `@/modules/*`, and `@/ai/*`
- Avoid deep relative imports when aliases already exist

## Naming
- Classes: PascalCase
- Functions and variables: camelCase
- State machine files use explicit suffixes like `*.guards.ts`, `*.actors.ts`, `*.primitive.ts`, and `*.update.ts`

## Project-Specific Conventions
- Keep memory persistence inside the dedicated memory manager under `src/core/memory/`
- Do not bolt new data onto ad hoc JSON blobs when schema changes are needed
- Add focused regression tests near the affected subsystem
- Keep subagent roles narrow and aligned with real repo boundaries