# VoxelPilot

## What This Is

VoxelPilot is an open-source Minecraft companion bot for solo survival players. It acts as an in-game assistant rather than a roleplay friend: it accepts player goals, uses an LLM-driven decision loop to choose the next bounded action, and executes work through a Mineflayer runtime governed by an XState HSM. The product goal is to improve vanilla survival play with a bot that can help, protect, gather, and support the player without turning into an unreliable black box.

## Core Value

The bot must remain functionally useful and structurally intact even when the LLM hallucinates, times out, or returns bad decisions.

## Requirements

### Validated

- ✓ The repository already boots a Mineflayer-based bot runtime with a structured `src/core` startup path.
- ✓ The project already contains plugin wiring for major runtime integrations under `src/modules/plugins/`.
- ✓ The bot already has a SQLite-backed long-term memory layer in `src/core/memory/`.
- ✓ The codebase already has targeted automated coverage for HSM, AI, combat, memory, config, and command-handling subsystems.

### Active

- [ ] Stabilize the HSM so invalid AI output or runtime failures do not corrupt bot state.
- [ ] Deliver a bounded MVP tool surface for the LLM with strong validation and predictable execution semantics.
- [ ] Prove that long-lived memory is useful and stable across real gameplay sessions.
- [ ] Make the bot capable of completing core solo-survival helper tasks in real gameplay, not only in isolated tests.
- [ ] Validate combat assistance and player-help flows without breaking task continuity.

### Out of Scope

- Multi-agent coordination between several bots on the same server — not part of the MVP.
- A real-time web UI / HSM inspector — useful later, but not part of the current milestone.
- Broad future macro-capabilities such as dedicated `FARMING` and `BUILDING` state families — defer until the MVP runtime is stable.
- Replacing the current architectural stack with a different runtime model — keep the existing foundation and harden it.

## Context

The current repository already contains the main architectural pillars: Mineflayer runtime integration, an XState HSM, an AI loop that consumes deterministic snapshots, a long-term SQLite memory layer, and plugin-based runtime extensions. What is still missing is not “more architecture slides” but a disciplined MVP slice that proves the bot works as a dependable solo-survival assistant in actual gameplay.

The public audience is open-source users who want a helper bot for survival Minecraft. That means the project cannot optimize only for synthetic tests or local hacks. The runtime must be robust, the AI interface must be bounded, and milestone acceptance must include real in-game validation by a player.

## Constraints

- **Architecture**: Preserve `mineflayer + XState + LLM tool loop + SQLite memory` as the core system shape.
- **Integrity**: The HSM is the runtime authority and must not be bypassed or weakened by LLM-driven behavior.
- **Providers**: MVP AI integrations are limited to OpenAI-compatible providers.
- **Verification**: Passing tests is necessary but insufficient; milestone acceptance also requires in-game validation.
- **Scope**: MVP is a solo-companion runtime, not a platform for multi-bot orchestration or visualization tooling.
- **Open source**: The repo and docs should remain understandable for public contributors and users.

## Key Decisions

| Decision                                                                                                                    | Rationale                                                                                                                 | Outcome   |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------- |
| Preserve the current runtime foundation (`src/modules`, `src/core/bot.ts`, `src/core/hsm.ts`, `src/core/CommandHandler.ts`) | The repo already has the right architectural skeleton; the problem is reliability and completeness, not lack of structure | — Pending |
| Treat the HSM as the non-negotiable integrity boundary                                                                      | The bot must survive bad AI output without entering corrupted runtime state                                               | — Pending |
| Use both atomic tools and bounded complex task tools/states                                                                 | Pure per-step LLM control is too slow and brittle for gameplay; bounded higher-level execution improves responsiveness    | — Pending |
| Limit MVP provider support to OpenAI-compatible APIs                                                                        | This reduces variability while the runtime contract is still being hardened                                               | — Pending |
| Accept milestone completion only after in-game validation                                                                   | Synthetic tests alone do not prove the bot is useful or stable during real survival play                                  | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition**:

1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone**:

1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---

_Last updated: 2026-04-14 after project direction reset_
