# Coding Conventions

> **Focus:** quality
> **Generated:** 2026-04-06
> **Codebase:** voxel-pilot

## Naming Patterns

**Files:**

- PascalCase for classes: `CommandHandler.ts`, `AgentLoopGuard.ts`
- camelCase for modules/functions: `bot.ts`, `client.ts`, `loop.ts`, `tools.ts`
- Domain-suffixed HSM files: `combat.actors.ts`, `combat.guards.ts`, `primitiveBreaking.primitive.ts`, `antiLoop.ts`
- Barrel files: `index.general.utils.ts`, `index.plugins.ts`

**Functions & Methods:**

- camelCase throughout: `runAgentTurn`, `buildSnapshot`, `validateEnv`, `createBotMachine`
- Factory functions prefixed with `create`: `createBotMachine`, `createAgentClient`, `createVec3`, `createTestActor`
- Event handlers use present-tense verbs: `chat`, `init`, `start`, `stop`

**Variables:**

- camelCase: `currentGoal`, `pendingExecution`, `activeWindowSession`
- Private fields use `_` prefix on interface-level grouping: `_minecraft`, `_ai`, `_logging` in `Config`
- Constants: UPPER_SNAKE_CASE not used; module-level constants use camelCase: `MAX_INLINE_TOOL_ROUNDS`, `DB_VERSION`

**Types & Interfaces:**

- PascalCase for interfaces: `MachineContext`, `MachineEvent`, `AgentToolDefinition`, `PendingExecution`
- PascalCase for type aliases: `AgentTurnResult`, `HealthEvents`, `CombatEvents`, `InlineToolName`
- Suffix conventions: `*Events` for event unions, `*ToolName` for tool name literals, `*Context` for context types

**Classes:**

- PascalCase: `Config`, `MemoryManager`, `BotLogger`, `OpenAIResponsesClient`, `AntiLoopGuard`
- Default exports are common for single-class files: `export default class CommandHandler`

## Code Style

**Formatting (`.prettierrc`):**

```json
{
	"trailingComma": "none",
	"tabWidth": 2,
	"useTabs": true,
	"semi": false,
	"singleQuote": true,
	"jsxSingleQuote": true,
	"arrowParens": "avoid"
}
```

Key rules: tabs for indentation, no semicolons, single quotes, no trailing commas, avoid parens for single-arrow params.

**Run formatting:**

```bash
npm run format    # prettier --write "src/**/*.{ts,js}"
```

## Import Organization

**Order (enforced by `@trivago/prettier-plugin-sort-imports`):**

1. Node built-ins: `^node:(.*)$`
2. Third-party modules: `<THIRD_PARTY_MODULES>`
3. Type imports from `@/types`
4. Config: `@/config/(.*)`
5. Core: `@/core/(.*)`
6. HSM: `@/hsm/(.*)`
7. Modules: `@/modules/(.*)`
8. Utils: `@/utils/(.*)`
9. Relative: `^[./]`

Groups are separated by blank lines (`importOrderSeparation: true`) and specifiers are sorted (`importOrderSortSpecifiers: true`).

**Path Aliases (`tsconfig.json`):**

```json
{
	"@/*": ["src/*"],
	"@/types": ["src/types/index.ts"],
	"@/hsm/*": ["src/hsm/*"],
	"@/config/*": ["src/config/*"],
	"@/utils/*": ["src/utils/*"],
	"@/modules/*": ["src/modules/*"],
	"@/core/*": ["src/core/*"]
}
```

**Example from `src/hsm/machine.ts`:**

```typescript
import { Vec3 as Vec3Class } from 'vec3'
import { assign, fromPromise, setup } from 'xstate'

import type { Bot, Entity } from '@/types'

import combatActors from '@/hsm/actors/combat.actors'
import { primitiveCloseWindow } from '@/hsm/actors/primitives/primitiveCloseWindow.primitive'
import { type MachineContext, context } from '@/hsm/context'
import combatGuards from '@/hsm/guards/combat.guards'
import type { MachineEvent } from '@/hsm/types'

import { canSeeEnemy } from '@/utils/combat/enemyVisibility'
import { hasMovementController } from '@/utils/combat/movementController'
```

## Error Handling

**Patterns observed:**

1. **Throw early with descriptive messages** — `src/config/env.ts`:

```typescript
throw new Error(`\n❌ Invalid environment variables:\n${errors}\n`)
```

2. **Guard checks before operations** — `src/core/memory/index.ts`:

```typescript
private getDb(): SqliteDatabase {
  if (!this.db) {
    throw new Error('MemoryManager is not loaded. Call load() first.')
  }
  return this.db
}
```

3. **Result objects for recoverable failures** — `src/ai/tools.ts`:

```typescript
interface InlineToolExecutionResult {
	ok: boolean
	output: Record<string, unknown>
}
```

4. **Event-driven failure propagation in HSM** — primitives emit `*_FAILED` events rather than throwing:

```typescript
// From src/hsm/machine.ts
on: {
  NAVIGATION_FAILED: {
    target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
    actions: ['recordExecutionFailure']
  },
  ERROR: {
    target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
    actions: ['recordExecutionFailure']
  }
}
```

5. **Anti-loop guard as safety net** — `src/core/hsm.ts` subscribes to state changes and calls `process.exit(1)` if the guard detects a loop.

6. **`as any` casts for test doubles** — tests extensively use `as any` for mock bot objects rather than implementing full interfaces. This is an accepted pattern in test files.

## Logging

**Framework:** Winston (`src/config/logger.ts`)

**Logger singleton:**

```typescript
import Logger from '@/config/logger'

Logger.info('Bot started')
Logger.error('Connection failed', { error: message })
```

**BotLogger wrapper** adds structured methods:

- `botAction(action, status, data)` — tracks bot actions with correlation IDs
- `playerCommand(username, command, params)` — logs player commands
- `aiCall(prompt, response, duration)` — logs AI interactions
- `exception(error, context)` — logs stack traces

**Correlation IDs:** Generated per operation via `setCorrelationId()`, included in all log entries.

**HSM logging** uses `console.log` with structured prefixes:

```typescript
console.log(
	'[HSM] enter MAIN_ACTIVITY.COMBAT',
	JSON.stringify({ event, targetId, distance })
)
console.log(
	'[AI] thinking_start',
	JSON.stringify({ goal, subGoal, lastAction })
)
```

**Log levels:** `debug`, `info`, `warn`, `error`. Development defaults to `debug`; production uses configured level.

**Log rotation:** File transport rotates at 10MB, keeps 5 files. Separate `error.log` for errors only.

## Comments

**When to Comment:**

- Complex business logic (e.g., grounding validation in `src/ai/loop.ts`)
- Non-obvious type assertions
- Russian-language comments are used throughout the codebase (logger messages, some inline comments)

**JSDoc:** Minimal usage. Some interfaces have no docstrings. Key public APIs like `MemoryManager` methods lack JSDoc.

**Inline comments:** Used sparingly. Debug markers appear as comments like `// debug: model_request_start` (stripped in production).

## Function Design

**Size:** Functions are generally focused and single-purpose. `runAgentTurn` in `src/ai/loop.ts` (~280 lines) is the largest, but it's the core agent loop with clear sections.

**Parameters:** Prefer single input objects over multiple positional params:

```typescript
// Good — observed pattern
export const runAgentTurn = async (input: AgentTurnInput): Promise<AgentTurnResult> => { ... }

// Interface defines all params
interface AgentTurnInput {
  bot: Bot
  memory: MemoryManager
  currentGoal: string
  // ...
}
```

**Return Values:**

- Discriminated unions for multi-outcome functions: `AgentTurnResult` with `kind: 'execute' | 'finish' | 'failed'`
- Nullable returns for lookups: `MemoryEntry | null`
- Result objects for operations that can fail: `{ ok: boolean, output: Record<string, unknown> }`

## Module Design

**Exports:**

- Named exports for utilities, types, and constants
- Default exports for primary classes: `Config`, `MemoryManager`, `BotLogger`, `CommandHandler`, `MinecraftBot`, `BotStateMachine`
- Re-exports through barrel files: `src/types/index.ts` re-exports external types

**Barrel Files:**

- `src/types/index.ts` — central type re-exports
- `src/utils/general/index.general.utils.ts` — utility barrel
- `src/modules/plugins/index.plugins.ts` — plugin barrel

**Factory pattern:** `createBotMachine()` in `src/hsm/machine.ts` accepts optional overrides for testing:

```typescript
export const createBotMachine = (options?: MachineFactoryOptions) => { ... }
export const machine = createBotMachine()
```

## TypeScript Configuration

**Strictness (`tsconfig.json`):**

```json
{
	"strict": true,
	"noUncheckedIndexedAccess": true,
	"noImplicitReturns": true,
	"noFallthroughCasesInSwitch": true,
	"esModuleInterop": true,
	"isolatedModules": true,
	"skipLibCheck": true,
	"forceConsistentCasingInFileNames": true
}
```

**Target:** ES2022, module: ESNext, moduleResolution: node.

**Dead code detection:** `knip` is configured with all rules set to `error` for files, dependencies, unlisted, binaries, and unresolved imports.

## Common Patterns

**EventEmitter extension:** Classes extend `EventEmitter` for bot lifecycle:

```typescript
class MinecraftBot extends EventEmitter { ... }
class FakeBot extends EventEmitter { ... }  // test doubles
```

**XState actor pattern:** Machine creation with dependency injection for testability:

```typescript
const actor = createActor(createBotMachine({
  thinkingActor: hangingActor,
  actors: { serviceEntitiesTracking: noopActor, ... }
}), { input: { bot } })
```

**Singleton pattern:** Config and Logger are instantiated as singletons:

```typescript
export default new Config()
export default new BotLogger()
```

**Guard/validation functions:** Pure functions returning booleans or error strings:

```typescript
const validateInlineTool = (name, args, taskContext): string | null => { ... }
const validateExecutionTool = (bot, execution, taskContext, groundedFacts): string | null => { ... }
```

---

_Convention analysis: 2026-04-06_
