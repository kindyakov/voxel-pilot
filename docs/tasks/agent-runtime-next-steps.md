# Agent Runtime Next Steps

This file captures the current follow-up work for the agent runtime so it can be resumed in a new session without relying on chat history.

## Current State

- `taskContext` was introduced into the HSM/runtime as short-lived working task state.
- The AI snapshot was cleaned up to remove unsupported workstation noise such as `stonecutter`.
- A basic semantic validator was added to block clearly irrelevant execution steps for craft tasks.

## Important Open Question

The semantic validator may be too heavy or redundant.
It should be re-evaluated after the task-context and snapshot layers become stronger.
Do not assume it is the final architectural direction.

## Next Tasks

1. Build `taskContext` from real recipe and prerequisite chains using `recipesFor`, inventory state, and workstation requirements.
2. Make the snapshot show resource deficits, next-needed materials, and only goal-relevant workstation/resource context.
3. Standardize primitive feedback into machine-readable task facts so progress toward a goal is explicit and deterministic.
4. Revisit inline tool semantics, especially `memory_save`, so only task-relevant or broadly durable knowledge is persisted.
5. Reassess whether the semantic validator should remain, be reduced, or be removed once task context and snapshot relevance are strong enough.

## Resume Guidance

If work resumes later, start with task-context enrichment from recipes and inventory.
Only after that decide whether the semantic validator is still needed.
