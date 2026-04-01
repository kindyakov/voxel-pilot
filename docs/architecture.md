# Architecture

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

`TASKS` uses this loop:

- `IDLE`
- `THINKING`
- `EXECUTING`
- `DECIDE_NEXT`

`THINKING` calls `runAgentTurn()`.
`EXECUTING` resolves one pending execution tool to a primitive:

- `call_navigate` -> `primitiveNavigating`
- `call_break_block` -> `primitiveBreaking`
- `call_craft` -> `primitiveCraft`
- `call_craft_workbench` -> `primitiveCraftInWorkbench`
- `call_smelt` -> `primitiveSmelt`
- `call_place_block` -> `primitivePlacing`
- `call_follow_entity` -> `primitiveFollowing`

## AI Loop

`src/ai/loop.ts` does one turn at a time.
It builds a deterministic snapshot, sends it to the model, and accepts only three kinds of outcomes:

- one execution tool
- a `finish_goal` control tool
- inline memory/container tools that are resolved locally before the next model round

The loop is intentionally strict:

- one execution decision only
- no plain text answers
- no mixed terminal and execution actions
- retry is limited when the model fails to return a tool call

## Snapshot

`src/ai/snapshot.ts` summarizes:

- health, food, oxygen
- position, dimension, biome, day/night
- inventory, equipment, free slots
- nearby interactable blocks
- nearby resource blocks
- nearby entities
- current goal and subgoal
- last action result and recent errors

## Combat

Combat is handled by dedicated actors, not by the AI loop.
The combat layer can:

- approach a target
- flee from a target
- melee attack
- ranged skirmish

Visibility and reachability checks are shared with guards and monitoring logic.

## Memory

Long-term memory is backed by SQLite under `data/`.
The memory manager stores locations, containers, resources, danger markers, player notes, task stats, deaths, and goal history.

## Source Of Truth

These docs are a summary of the codebase state, not a separate specification.
When behavior changes, update code and tests first, then update the docs.
