# Minecraft Bot AI Refactor

## What This Is

This repository contains a Mineflayer-based Minecraft bot with an AI-driven task loop, XState-based HSM orchestration, runtime world inspection, and persistent memory. This planning workspace bootstraps a brownfield refactor program focused on the overloaded `src/ai` module cluster so that future execution can happen through GSD without inventing scope on the fly.

## Core Value

The bot's AI planning and execution behavior must stay stable while the `src/ai` subsystem becomes small enough to change safely.

## Requirements

### Validated

- ✓ The bot already runs an `AGENT_LOOP` inside the HSM task flow.
- ✓ Existing AI behavior is guarded by agent loop, client, and window runtime tests.

### Active

- [ ] Split AI client contracts, provider adapters, and factory ownership.
- [ ] Split tool catalog, tool taxonomy, and inline runtime execution ownership.
- [ ] Split `runAgentTurn` orchestration from validation, grounding, and loop policy.
- [ ] Preserve existing entrypoint imports, HSM integration, tests, and build behavior during refactor.

### Out of Scope

- New gameplay capabilities or user-facing features — this bootstrap is for structural refactor only.
- HSM topology redesign — execution may update imports, but not state-machine architecture.
- Snapshot or runtime mechanic changes unless they are strictly required to keep parity.

## Context

The current codebase already has codebase maps under `.planning/codebase/` and a source architecture brief in `.planning/phases/PLAN.md`. The immediate goal is to convert that raw architectural brief into executable GSD artifacts so the refactor can later run in controlled waves instead of as an ad hoc rewrite.

## Constraints

- **Tech stack**: TypeScript, Node.js, OpenAI-compatible providers, XState, Mineflayer — existing runtime contracts must keep working.
- **Compatibility**: Keep `src/ai/client.ts`, `src/ai/tools.ts`, and `src/ai/loop.ts` as backward-compatible facades during migration.
- **Verification**: Existing tests and build checks remain the regression gate for every execution wave.
- **Process**: GSD artifacts must be valid enough for `gsd-execute-phase` to recognize the phase later.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Bootstrap a single refactor phase first | The workspace has no valid ROADMAP/STATE/phase directory yet | ✓ Good |
| Preserve `.planning/phases/PLAN.md` as source material | The original architecture brief should remain readable and auditable | ✓ Good |
| Use four executable plans across three waves | `client`, `tools`, and `loop` have different seams and should not be rewritten in one pass | ✓ Good |
| Keep facades while moving logic | Backward compatibility matters more than aggressive cleanup in wave 1 | ✓ Good |

---
*Last updated: 2026-04-10 after GSD bootstrap from `.planning/phases/PLAN.md`*
