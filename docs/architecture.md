# Architecture

Language versions: [English](architecture.md) | [Русский](architecture.ru.md)

This bot is a Mineflayer runtime wrapped in an XState machine.
The current design is small and explicit:

- `src/index.ts` loads dotenv and starts the bot.
- `src/core/bot.ts` handles connect, reconnect, and shutdown.
- `src/core/CommandHandler.ts` converts chat into HSM events.
- `src/core/hsm.ts` wires the state machine to the bot runtime.
- `src/ai/loop.ts` runs the agent loop.
- `src/ai/snapshot.ts` builds the model snapshot.
- `src/core/memory/` owns persistent storage.

## System Goal

The goal of this project is not to hardcode behavior for individual requests such as "make an axe".
The goal is to build a reliable agent runtime for a Minecraft bot.

That runtime must:

- accept both simple and multi-step user goals
- decompose goals into coherent sequential actions
- execute actions only through clear bot primitives
- keep the bot state consistent through the HSM
- remain resilient to failures, interruptions, and partial progress
- allow the agent loop, tools, and primitives to evolve without rewriting the system around one-off cases

In practical terms, the LLM is not the source of truth for behavior.
The source of truth must be the runtime contract:

- deterministic world snapshot in
- one valid decision at a time
- execution through bounded primitives
- explicit success or failure back into the machine
- recovery paths that preserve bot integrity

## Non-Goals

This system is not meant to:

- solve tasks by adding prompt rules for every specific request
- let the model improvise arbitrary behavior outside the tool and primitive contract
- couple core architecture to isolated examples or regressions
- trade reliability for short-term "it worked once" behavior

## Runtime Flow

1. The bot connects to the Minecraft server.
2. Plugins and runtime helpers are initialized.
3. The HSM starts with `MAIN_ACTIVITY` and `MONITORING` in parallel.
4. A chat command becomes a goal.
5. The AI loop either finishes the goal or returns one execution tool.
6. Execution tools invoke a concrete primitive actor.
7. The machine records success or failure and either continues or stops.

## HSM Shape

The machine does not have a task planner or plan executor.
That old design was removed.

Current top-level states:

- `MAIN_ACTIVITY.IDLE`
- `MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_EATING`
- `MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_HEALING`
- `MAIN_ACTIVITY.COMBAT`
- `MAIN_ACTIVITY.TASKS`
- `MONITORING`

While alive in `MAIN_ACTIVITY.IDLE`, the bot smoothly watches visible players and peaceful mobs within `preferences.idleGazeRadius` (8 blocks by default). It prefers the nearest, holds attention for 3–5 seconds, and occasionally picks another. Obstacles block visibility, endermen are excluded, and losing the entity ends tracking. This only turns the view, without walking; tasks, combat, and survival take over when idle ends.

`TASKS` uses this loop:

- `IDLE`
- `THINKING`
- `EXECUTING`
- `DECIDE_NEXT`

`THINKING` calls `runAgentTurn()`.
`EXECUTING` resolves one pending execution tool to a primitive.
Canonical names (see `src/ai/tools/catalog.ts`, `src/ai/tools/names.ts` — code wins over this doc):

- `navigate_to` -> `primitiveNavigating`
- `break_block` -> `primitiveBreaking`
- `mine_resource` -> `MINING` batch sub-state (`CHECKING_PRECONDITIONS -> SEARCHING -> CHECKING_DISTANCE -> NAVIGATING/BREAKING -> CHECKING_GOAL -> TASK_COMPLETED/TASK_FAILED`)
- `place_block` -> `primitivePlacing`
- `follow_entity` -> `primitiveFollowing`
- `open_window` -> `primitiveOpenWindow`
- `transfer_item` -> `primitiveTransferItem`
- `close_window` -> `primitiveCloseWindow`

There are no `call_craft` / `call_smelt` primitives in the current machine. `mine_resource` performs its own batch search and does not require a grounded `inspect_blocks` position first.

## Interruption and failure contracts

Vital monitoring updates context only; `MAIN_ACTIVITY` owns emergency transitions. Repeated critical updates do not restart recovery. Healing takes priority over eating. Recovery returns through `RESUMING` to `TASKS.THINKING` when a goal exists, otherwise to `IDLE`; it never restores an interrupted execution through deep history. Pending execution and mining state are discarded on interruption so the agent must inspect and replan against the live world.

Unavailable food or a recovery error releases the active task with a failure reason instead of locking it in survival. Automatic retries are suppressed until food becomes available (for missing-food failures), vitals recover, or a new goal is issued. Recovery has a 60-second deadline.

Callback services deliver synchronous and asynchronous failures as `ERROR`. They subscribe before startup, serialize each tick handler, clear timers/listeners on exit, and suppress results after cancellation. Breaking also cancels digging and inventory waits; a canceled actor cannot set or clear the next actor's movement goal. Navigation handles `path_update` failures and has a 30-second deadline, as does breaking. Placing, opening windows, and transfers have 15-second deadlines. Continuous `follow_entity` remains active until cancellation or target disappearance.

Ranged equip failure disables ranged combat for the current encounter and falls back to melee. Combat async operations, including startup equip, have a 15-second deadline without limiting the duration of a healthy encounter. A combat service error exits combat and suppresses automatic re-entry. Fleeing uses the movement controller's terrain heuristics; its fallback yaw follows Mineflayer's forward-axis convention.

The shared policy in `src/ai/goalExecution.ts` stops a goal after three consecutive rejections or execution failures, including different causes, or after 128 started actions. Success resets consecutive failures, not the total budget; combat/survival interruption preserves both counters. Invalid model actions produce `rejected` and may be corrected in the next turn; exhausted provider retries remain terminal `failed`. The global transition-rate guard resets its internal detection state after its 60-second cooldown.

`WindowRuntime` owns both active and temporary windows. Failed close retains the session for retry and blocks other window operations, but never delays survival. Cancellation or a 15-second deadline releases the caller; an unresolved Mineflayer call keeps the window slot occupied until it settles. Late cleanup cannot close a newer window or complete another execution. Close confirmation is local release of the owned window, not a server acknowledgment.

Eating performs one attempt at a time; only the active survival actor owns retries. Movement decisions continue while food is being consumed, so canceling food to flee does not wait for that attempt to settle or schedule an independent retry.

## AI Loop

`src/ai/loop.ts` does one turn at a time.
It builds a deterministic snapshot, sends it to the model, and handles these model requests:

- one execution tool
- a `finish_goal` control tool
- inline memory/container tools that are resolved locally before the next model round

The loop is intentionally strict:

- one execution decision only
- execution/control must be the only call in a response; mixed responses are rejected before inline side effects
- retry is limited when the model fails to return a tool call
- plain-text output without a tool call is `rejected`, unless inspect data was already gathered in the turn (grounded fallback to `finish`; see `docs/tasks/grounded-plain-text-fallback-для-agent-loop.md`)

Execution schemas, typed argument variants, parsers, and summaries live together in `src/ai/tools/executionDefinitions.ts`. Validation does not coerce supplied values or replace invalid options with defaults. Provider tools use `strict: false` to retain omitted optional fields; execution arguments are validated locally before HSM dispatch.

## Snapshot

`src/ai/snapshot.ts` is intentionally minimal. It summarizes only the current cycle state:

- health, food, oxygen
- position, dimension
- active window session summary
- current goal and subgoal
- last action result and recent errors

Inventory, equipment, nearby blocks, entities, and interactables are NOT in the snapshot. The agent must fetch live world facts through inspect tools (`inspect_inventory`, `inspect_blocks`, `inspect_entities`, `inspect_window`). See `docs/tasks/сужение-snapshot-и-переход-к-inspect-tools.md` for the boundary rationale.

## Combat

Combat is handled by dedicated actors, not by the AI loop.
`MAIN_ACTIVITY.COMBAT` currently has two leaf states selected by `DECIDING`:

- `MELEE_ATTACKING`
- `RANGED_SKIRMISHING`

There are no `APPROACHING` / `FLEEING` states in the current machine. If the combat diagram shows them, the diagram is stale.

Visibility and reachability checks are shared with guards and monitoring logic.

## Memory

Long-term memory is backed by SQLite under `data/`.
The memory manager stores locations, containers, resources, danger markers, player notes, task stats, deaths, and goal history.

## Source Of Truth

These docs are a summary of the codebase state, not a separate specification.
When behavior changes, update code and tests first, then update the docs.
