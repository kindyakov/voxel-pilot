# Testing Patterns

> **Focus:** quality
> **Generated:** 2026-04-06
> **Codebase:** voxel-pilot

## Test Framework

**Runner:**

- Node.js native test runner (`node:test`)
- No external test framework installed — uses built-in `test` and `assert/strict`
- Config: no separate config file; uses Node.js defaults

**Assertion Library:**

- `node:assert/strict` — strict equality, deep equality, match, throws/doesNotThrow

**Run Commands:**

```bash
npx tsx --test src/tests/ai/agentLoop.test.ts      # Run single test file
npx tsx --test src/tests/**/*.test.ts               # Run all tests
npx tsx --test src/tests/hsm/machine.test.ts        # Run HSM tests
```

No watch mode or coverage commands are configured. Coverage is not enforced.

## Test File Organization

**Location:**

- Co-located under `src/tests/` mirroring source structure:

```
src/tests/
├── ai/                          # AI agent loop, client, snapshot tests
│   ├── agentLoop.test.ts
│   ├── AgentLoopGuard.test.ts
│   ├── snapshot.test.ts
│   └── windowRuntime.test.ts
├── config/                      # Configuration validation tests
│   └── config.test.ts
├── core/                        # Core bot, command handler, memory tests
│   ├── ChatClient.test.ts
│   ├── CommandHandler.test.ts
│   ├── OpenAIClient.test.ts
│   └── memory/
│       └── MemoryManager.test.ts
├── hsm/                         # State machine and combat tests
│   ├── antiLoop.test.ts
│   ├── combat.runtime.test.ts
│   ├── combatRegression.test.ts
│   └── machine.test.ts
└── utils/                       # Utility function tests
    └── enemyVisibility.test.ts
```

**Naming:**

- `{ComponentName}.test.ts` — matches source file or subsystem name
- Test files live in parallel directory structure under `src/tests/`

## Test Structure

**Suite Organization:**

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'

import { SomeModule } from '../../path/to/module.js'

test('descriptive test name', async () => {
	// Arrange
	const instance = new SomeModule()

	// Act
	const result = instance.doSomething()

	// Assert
	assert.equal(result, expected)
})
```

**Patterns observed:**

- Each `test()` call is a single test case — no nested `describe`/`it` blocks
- Test names are descriptive sentences: `'runAgentTurn resolves inline memory tool calls before selecting one execution action'`
- Async tests use `async/await` — no callback style
- `try/finally` blocks for cleanup (actor stop, resource cleanup):

```typescript
test('machine enters TASKS.THINKING on USER_COMMAND', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Build a shelter'
		})
		await waitForTurn()

		assert.equal(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { TASKS: 'THINKING' } } as never),
			true
		)
	} finally {
		actor.stop()
	}
})
```

## Mocking

**Framework:** None — manual mock objects and fake classes

**Patterns:**

1. **Fake classes extending EventEmitter** — `src/tests/hsm/machine.test.ts`:

```typescript
class FakeBot extends EventEmitter {
	username = 'Bot'
	entity = { id: 999, position: createVec3(0, 64, 0), height: 1.8 }
	health = 20
	food = 20
	inventory = { slots: Array.from({ length: 46 }, () => null), items: () => [] }
	// ... many no-op methods
	chat(message: string) {
		this.chatMessages.push(message)
	}
	quit() {}
	blockAt() {
		return null
	}
	nearestEntity() {
		return null
	}
}
```

2. **`as any` casting for partial mocks** — used extensively for bot objects in tests:

```typescript
const bot = {
	memory,
	health: 20,
	food: 20,
	entity: { position: createVec3(0, 64, 0) },
	inventory: { slots: Array.from({ length: 46 }, () => null), items: () => [] },
	blockAt: () => null
	// ... only what the test needs
} as any
```

3. **Mock client injection** — AI client tests inject mock SDK clients:

```typescript
const client = new OpenAIResponsesClient({
	client: {
		responses: {
			create: async () => responses.shift() as any
		}
	},
	model: 'test-model'
})
```

4. **HSM actor overrides** — replace invoked actors with no-op or hanging actors:

```typescript
const hangingActor = fromPromise(async () => {
	return await new Promise<never>(() => {})
})

const noopActor = fromPromise(async () => {})

const actor = createActor(
	createBotMachine({
		thinkingActor: hangingActor,
		actors: {
			serviceEntitiesTracking: noopActor,
			serviceApproaching: noopActor,
			serviceMeleeAttack: noopActor,
			serviceFleeing: noopActor,
			serviceEmergencyEating: hangingActor,
			serviceEmergencyHealing: hangingActor
		}
	}),
	{ input: { bot } }
)
```

5. **Environment variable manipulation** — config tests save/restore `process.env`:

```typescript
test('Config reads provider base URL', () => {
	const previousEnv = {
		AI_PROVIDER: process.env.AI_PROVIDER,
		AI_MODEL: process.env.AI_MODEL
		// ...
	}

	process.env.AI_PROVIDER = 'openrouter'
	process.env.AI_MODEL = 'minimax/minimax-m2.5:free'

	try {
		const config = new Config()
		assert.equal(config.ai.provider, 'openrouter')
	} finally {
		for (const [key, value] of Object.entries(previousEnv)) {
			if (typeof value === 'undefined') {
				delete process.env[key]
			} else {
				process.env[key] = value
			}
		}
	}
})
```

**What to Mock:**

- External AI clients (OpenAI SDK) — always mocked with canned responses
- Mineflayer bot methods — faked with EventEmitter subclasses or `as any` objects
- HSM invoked actors — replaced with no-op or hanging actors via `createBotMachine` options
- File system — memory tests use `os.tmpdir()` with `fs.mkdtemp`

**What NOT to Mock:**

- HSM state machine logic itself — tests use real `createBotMachine` with only actors overridden
- MemoryManager CRUD operations — tests use real SQLite with temp databases
- Config validation — tests use real `Config` class with manipulated env vars

## Fixtures and Factories

**Test Data:**

- Inline factory functions within test files:

```typescript
const createVec3 = (x: number, y: number, z: number) => ({
  x, y, z,
  distanceTo(other) { ... }
})

const createEnemy = (id: number, distance: number) => ({
  id, type: 'hostile', name: 'skeleton',
  height: 1.8, isValid: true,
  position: new Vec3(distance, 64, 0)
})

const createTestActor = () => {
  const bot = new FakeBot() as any
  const actor = createActor(createBotMachine({ ... }), { input: { bot } })
  bot.hsm = { getContext: () => actor.getSnapshot().context }
  actor.start()
  return { bot, actor }
}
```

**Location:**

- No shared fixtures directory — each test file defines its own helpers
- `createVec3` is duplicated across multiple test files (`agentLoop.test.ts`, `machine.test.ts`, `snapshot.test.ts`)

**Temporary directories for memory tests:**

```typescript
const createTempDataDir = async (): Promise<string> => {
	return fs.mkdtemp(path.join(os.tmpdir(), 'minecraft-botMemory-'))
}
```

## Coverage

**Requirements:** None enforced — no coverage threshold configured.

**View Coverage:** Not configured. Node.js test runner supports `--experimental-test-coverage` but it's not wired into any npm script.

## Test Types

**Unit Tests:**

- **Scope:** Individual functions, classes, and modules
- **Approach:** Isolate with fakes/mocks, assert specific behaviors
- **Examples:** `MemoryManager` CRUD, `Config` parsing, `AntiLoopGuard` logic, `CommandHandler` message routing, `OpenAIResponsesClient` response mapping

**Integration Tests:**

- **Scope:** HSM state transitions, AI agent loop turns, window session lifecycle
- **Approach:** Real state machine with mocked actors, real MemoryManager with temp SQLite
- **Examples:** `machine.test.ts` (HSM transitions), `agentLoop.test.ts` (AI tool validation), `combatRegression.test.ts` (combat service behavior)

**E2E Tests:**

- Not used. Live Minecraft session testing is documented manually per AGENTS.md guidance.

## Common Patterns

**Async Testing with `waitForTurn`:**

```typescript
const waitForTurn = async () => {
	await delay(0)
	await delay(0)
}
```

Used in HSM tests to allow the state machine to process events before assertions.

**Conditional Waiting:**

```typescript
const waitForCondition = async (
	condition: () => boolean,
	timeoutMs: number
) => {
	const started = Date.now()
	while (!condition()) {
		if (Date.now() - started > timeoutMs) {
			throw new Error(`Condition not reached in ${timeoutMs}ms`)
		}
		await delay(25)
	}
}
```

Used in combat regression tests for timing-dependent assertions.

**Error Testing:**

```typescript
assert.doesNotThrow(() => config.assertAIConfigured())

assert.equal(result.kind, 'failed')
if (result.kind !== 'failed') {
	assert.fail('Expected failed result')
}
assert.match(
	result.reason,
	/open_window.*requires a window-compatible position grounded/i
)
```

**Transcript/round timing assertions:**

```typescript
assert.match(result.transcript[0]!, /^round_0_ms:\d+$/)
assert.match(result.transcript[2]!, /^round_1_ms:\d+$/)
```

**Multi-step state machine testing:**

```typescript
actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Open the window' })
await waitForTurn()
await waitForTurn()

assert.equal(openCalls, 1)
assert.equal(closeCalls, 1)
assert.equal((actor.getSnapshot().context as any).activeWindowSession, null)
```

**Promise gating for async coordination:**

```typescript
let releaseRetry: () => void = () => {}
const retryGate = new Promise<void>(resolve => {
	releaseRetry = resolve
})
// ... later in test
releaseRetry()
```

## Test File Summary

| File                                          | Lines  | Tests  | Focus                                                         |
| --------------------------------------------- | ------ | ------ | ------------------------------------------------------------- |
| `src/tests/ai/agentLoop.test.ts`              | ~600   | 12     | AI tool grounding, validation, turn logic                     |
| `src/tests/ai/AgentLoopGuard.test.ts`         | ~50    | 1      | Anti-loop guard behavior                                      |
| `src/tests/ai/snapshot.test.ts`               | ~100   | 2      | Snapshot building, window session rendering                   |
| `src/tests/ai/windowRuntime.test.ts`          | varies | varies | Window session runtime behavior                               |
| `src/tests/config/config.test.ts`             | ~40    | 1      | Config parsing, env validation                                |
| `src/tests/core/CommandHandler.test.ts`       | ~80    | 5      | Chat command parsing                                          |
| `src/tests/core/ChatClient.test.ts`           | varies | varies | Chat client behavior                                          |
| `src/tests/core/OpenAIClient.test.ts`         | ~50    | 1      | OpenAI response mapping                                       |
| `src/tests/core/memory/MemoryManager.test.ts` | ~80    | 3      | SQLite CRUD, legacy migration                                 |
| `src/tests/hsm/machine.test.ts`               | ~500+  | 20+    | HSM state transitions, combat, urgent needs, window lifecycle |
| `src/tests/hsm/antiLoop.test.ts`              | ~30    | 1      | Anti-loop guard                                               |
| `src/tests/hsm/combat.runtime.test.ts`        | varies | varies | Combat runtime behavior                                       |
| `src/tests/hsm/combatRegression.test.ts`      | ~200   | 7      | Combat service cleanup, eating dedup, visibility              |
| `src/tests/utils/enemyVisibility.test.ts`     | varies | varies | Enemy visibility logic                                        |

---

_Testing analysis: 2026-04-06_
