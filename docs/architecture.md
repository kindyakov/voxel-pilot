# Architecture

Language versions: [English](architecture.md) | [Русский](architecture.ru.md)

This bot is a Mineflayer runtime wrapped in an XState machine.
The current design is small and explicit:

- `packages/application/` owns the explicit settings/path policy and runtime composition shared by CLI and TUI. Each application owns its renderer, signals and bounded shutdown around the portable runtime stop and caller-owned logger.
- `apps/tui/` renders the connection, safe bounded log history and public measured status through React/Ink. Its separate display clock advances the MAIN_ACTIVITY timer without sending HSM events; unknown, stale and paused facts remain distinct. TTY validation runs before settings or runtime allocation; resizing keeps the same runtime and subscriptions. `apps/cli/` remains the headless entrypoint.
- `packages/contracts/` defines portable runtime interfaces and serializable snapshots/results.
- `packages/presentation/` exports a contracts-only log model for INFO+/DEBUG filtering, LIVE/paused navigation, source-ID anchors and cumulative arrival counts. It keeps the current bounded projection; source history remains in core and terminal widths/keys remain in TUI.
- `packages/core/src/core/runtime.ts` provides the frozen start/stop/telemetry facade. Subscribers immediately receive a cached complete snapshot; unmeasured values are unknown.
- `packages/core/src/core/telemetry/logJournal.ts` owns the bounded safe source history and separate log stream, with stable IDs, byte/count limits and observable losses. Logger live-record observation owns no history; consumers filter the shared source for display. See [configuration](configuration.md#runtime-log-history) for limits and output policies.
- `packages/core/src/core/telemetry/` projects measured health, max health, food and position from the current native session, plus compact facts from its real HSM. Disconnect preserves stale measurements; a new session starts with unknown measurements. The behavior timer follows MAIN_ACTIVITY separately from monitoring; an active or paused goal remains visible during autonomous behavior.
- `packages/core/src/core/bot.ts` handles connect, reconnect, and shutdown.
- `packages/core/src/core/CommandHandler.ts` converts chat into HSM events.
- `packages/core/src/core/harness.ts` wires the state machine to the bot runtime with explicit instance dependencies.
- Optional native XState inspection is composed through the runtime's `inspection` option and trusted adapter types from `@voxel-pilot/core/inspection`. The harness attaches it before actor construction and releases it before persistence. Closing or failing an observer leaves bot ownership with the application; native events stay separate from portable telemetry and general logs. Its bounded queue reports dropped events and does not establish a complete future inspector trace or viewer.
- `packages/core/src/ai/loop.ts` runs the agent loop.
- `packages/core/src/ai/snapshot.ts` builds the model snapshot.
- `packages/core/src/core/memory/` owns persistent storage.

## System Goal

The goal of this project is not to hardcode behavior for individual requests such as "make an axe". The goal is to build a reliable autonomous harness for a Minecraft bot with an optional AI pilot.

The XState harness is the runtime authority and survives independently of LLM availability. The AI/LLM is a pilot: it makes the bot more autonomous and able to solve complex tasks, while the harness keeps its internal situational logic when the pilot is off; new goals are rejected and `:stop` remains available.

That runtime must:

- accept both simple and multi-step user goals
- decompose goals into coherent sequential actions
- execute actions only through clear bot primitives
- keep the bot state consistent through the HSM
- remain resilient to failures, interruptions, and partial progress
- survive a complete loss of AI: pause the active goal (not clear it), switch to autonomous survival (monitoring, tactical retreat, eating from inventory, self-defense, idle gaze)
- allow the agent loop, tools, and primitives to evolve without rewriting the system around one-off cases
- support a start toggle for AI (disabled mode as a first-class operational mode)

In practical terms, the LLM is not the source of truth for behavior. The source of truth must be the runtime contract:

- deterministic world snapshot in
- one valid decision at a time
- execution through bounded primitives
- explicit success or failure back into the machine
- recovery paths that preserve bot integrity
- goal pause (not clear) on AI failure, with resume when AI returns

## Non-Goals

This system is not meant to:

- solve tasks by adding prompt rules for every specific request
- let the model improvise arbitrary behavior outside the tool and primitive contract
- couple core architecture to isolated examples or regressions
- trade reliability for short-term "it worked once" behavior
- treat solo completion of the game with AI as a goal (it is an experiment, not MVP)

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
- `MAIN_ACTIVITY.DEFENSIVE_RELOCATION`
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
Canonical names (see `packages/core/src/ai/tools/catalog.ts`, `packages/core/src/ai/tools/names.ts` — code wins over this doc):

- `navigate_to` -> `primitiveNavigating`
- `break_block` -> `primitiveBreaking`
- `mine_resource` -> `MINING` batch sub-state (`CHECKING_PRECONDITIONS -> SEARCHING -> CHECKING_DISTANCE -> NAVIGATING/BREAKING -> CHECKING_GOAL -> TASK_COMPLETED/TASK_FAILED`)
- `place_block` -> `primitivePlacing`
- `follow_entity` -> `primitiveFollowing`
- `open_window` -> `primitiveOpenWindow`
- `transfer_item` -> `primitiveTransferItem`
- `close_window` -> `primitiveCloseWindow`

There are no `call_craft` / `call_smelt` primitives in the current machine. `mine_resource` performs its own batch search and does not require a grounded `inspect_blocks` position first.

Mining separates the source (`block_name`) from the requested item (`resource_name`). `count` measures new net inventory growth, excluding initial stock: external receipts count, spending or discarding items reduces current progress. Coal can come from regular or deepslate ore; preserving the exact ore block requires Silk Touch. Reaching the requested amount stops navigation or digging. Targets are refreshed before approach and again before digging; stale targets are skipped within the existing batch and unknown targets are deferred to the next search. Resume keeps confirmed progress and establishes a fresh inventory baseline, ignoring changes during the pause. The AI asks the player to clarify ambiguous output requests.

## Interruption and failure contracts

Vital monitoring updates context only; `MAIN_ACTIVITY` owns emergency transitions. Repeated critical updates do not restart recovery. Healing takes priority over eating. Recovery returns through `RESUMING`, which first enforces the shared goal budget: an exhausted goal stops in `IDLE`, suspended mining returns directly to `MINING` without spending a new agent turn, and other active goals continue through `TASKS.THINKING`; it never restores arbitrary interrupted execution through deep history. Combat, survival, or observation preemption suspends mining instead of discarding it: collected progress, the position blacklist, and the pending execution are retained. Completion, failure, `STOP_CURRENT_GOAL`, a new `USER_COMMAND`, or death clears the task. A broken block counts as collected only once its drop grows the inventory.

Unavailable food or a recovery error releases the active task with a failure reason instead of locking it in survival. Automatic retries are suppressed until food becomes available (for missing-food failures), vitals recover, or a new goal is issued. Recovery has a 60-second deadline.

Callback services deliver synchronous and asynchronous failures as `ERROR`. They subscribe before startup, serialize each tick handler, clear timers/listeners on exit, and suppress results after cancellation. Breaking also cancels digging and inventory waits; a canceled actor cannot set or clear the next actor's movement goal. Navigation handles `path_update` failures and has a 30-second deadline, as does breaking. Placing, opening windows, and transfers have 15-second deadlines. Continuous `follow_entity` remains active until cancellation or target disappearance.

Ranged equip failure disables ranged combat for the current encounter and falls back to melee. Combat async operations, including startup equip, have a 15-second deadline without limiting the duration of a healthy encounter. A combat controller failure stops combat in waiting; a target entering melee range does not clear that failure. Fleeing uses the movement controller's terrain heuristics; its fallback yaw follows Mineflayer's forward-axis convention.

The shared policy in `packages/core/src/ai/goalExecution.ts` stops a goal after three consecutive rejections or execution failures, including different causes, or after 128 started actions. Success resets consecutive failures, not the total budget; combat/survival interruption preserves both counters. Invalid model actions produce `rejected` and may be corrected in the next turn; exhausted provider retries remain terminal `failed`. The global transition-rate guard resets its internal detection state after its 60-second cooldown.

`WindowRuntime` owns both active and temporary windows. Failed close retains the session for retry and blocks other window operations, but never delays survival. Cancellation or a 15-second deadline releases the caller; an unresolved Mineflayer call keeps the window slot occupied until it settles. Late cleanup cannot close a newer window or complete another execution. Close confirmation is local release of the owned window, not a server acknowledgment.

Eating performs one attempt at a time; only the active survival actor owns retries. Movement decisions continue while food is being consumed, so canceling food to flee does not wait for that attempt to settle or schedule an independent retry.

## AI Loop

`packages/core/src/ai/loop.ts` does one turn at a time.
It builds a deterministic snapshot, sends it to the model, and handles these model requests:

- one execution tool
- a `finish_goal` control tool
- inline memory/container tools that are resolved locally before the next model round

The loop is intentionally strict:

- one execution decision only
- execution/control must be the only call in a response; mixed responses are rejected before inline side effects
- retry is limited when the model fails to return a tool call
- plain-text output without a tool call is `rejected`, unless inspect data was already gathered in the turn (grounded fallback to `finish`; see `docs/tasks/grounded-plain-text-fallback-для-agent-loop.md`)

Execution schemas, typed argument variants, parsers, and summaries live together in `packages/core/src/ai/tools/executionDefinitions.ts`. Validation does not coerce supplied values or replace invalid options with defaults. Provider tools use `strict: false` to retain omitted optional fields; execution arguments are validated locally before HSM dispatch.

## Snapshot

`packages/core/src/ai/snapshot.ts` is intentionally minimal. It summarizes only the current cycle state:

- health, food, oxygen
- position, dimension
- active window session summary
- current goal and subgoal
- last action result and recent errors

Inventory, equipment, nearby blocks, entities, and interactables are NOT in the snapshot. The agent must fetch live world facts through inspect tools (`inspect_inventory`, `inspect_blocks`, `inspect_entities`, `inspect_window`). See `docs/tasks/сужение-snapshot-и-переход-к-inspect-tools.md` for the boundary rationale.

## Combat

Combat is handled by dedicated actors, not by the AI loop.
Suitable weapons take priority. Without a melee weapon or usable ranged loadout, the bot frees its hand and defends itself with fists, including against an eligible nearby aggressive mob before its first hit. A bow without ammunition does not prevent fists. Broken weapons are replaced first; without a replacement the bot prepares an empty hand while preserving inventory. A completely full inventory makes it wait for space rather than discard an item. Players and bosses remain excluded targets; critical survival and dangerous creepers preempt self-defense.

Ordinary self-defense selects the nearest eligible target. A confirmed attacking shooter takes priority and permits extended melee approach. Observation maintains that contact separately from the nearest threat; unknown-source damage does not blame the nearest mob.

`MAIN_ACTIVITY.COMBAT` selects behavior through `DECIDING`:

- `MELEE_ATTACKING`
- `RANGED_SKIRMISHING`
- `WAITING` — stopped combat after exhausted approach or controller failure
- `RETREATING` — response to a dangerous creeper

The combat actor owns approach. It bounds failed routes and lack of actual progress while retaining the encounter budget across restarts. There is no total pursuit deadline. A current position permits navigation around a wall, but every hit requires reach and visibility. Losing the current position stops movement; remembered contact briefly retains the goal pause. Exhausted approach without ongoing fire retains waiting; continuing confirmed attack without an available response permits `DEFENSIVE_RELOCATION` at normal health.

Defensive relocation prefers reachable cover from a known shooter, then increasing distance. Cover and brief visibility loss do not resume the goal while contact remains relevant. Returning after unknown-source damage requires actual departure, fresh safe observation, and a separate quiet period. The harness controls this independently of AI while preserving goal progress and budget. Visibility and reachability checks are shared by guards and monitoring.

Visibility and reachability checks are shared with guards and monitoring logic.

## Memory

Long-term memory is backed by SQLite under `data/`.
The memory manager stores locations, containers, resources, danger markers, player notes, task stats, deaths, and goal history.

## Source Of Truth

These docs are a summary of the codebase state, not a separate specification.
When behavior changes, update code and tests first, then update the docs.
