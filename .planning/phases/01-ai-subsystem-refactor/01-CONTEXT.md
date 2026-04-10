# Phase 1: AI Subsystem Refactor - Context

**Gathered:** 2026-04-10
**Status:** Ready for execution
**Source:** Bootstrap from `.planning/phases/PLAN.md`

<domain>
## Phase Boundary

This phase decomposes the overloaded `src/ai/client.ts`, `src/ai/tools.ts`, and `src/ai/loop.ts` modules into focused submodules while preserving current runtime behavior, existing entrypoint imports, HSM integration, and regression tests.

</domain>

<decisions>
## Implementation Decisions

### Locked Decisions
- Keep `src/ai/client.ts`, `src/ai/tools.ts`, and `src/ai/loop.ts` as thin backward-compatible facades.
- Extract contracts before moving implementations.
- Split `client` first, then `tools`, then `loop`.
- Treat `PendingExecution`, `AgentModelClient`, and `AgentTurnInput/Result` as shared contracts, not local god-file types.
- Keep snapshot format and HSM state topology unchanged during early waves.
- Preserve behavioral parity and use existing tests as the regression gate for every wave.

### the agent's Discretion
- Exact helper names inside new `src/ai/client/*`, `src/ai/tools/*`, and `src/ai/loop/*` modules.
- Whether `src/hsm/*` continues to import facade types or switches to contract modules in the final wave, as long as compatibility is preserved.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source architecture brief
- `.planning/phases/PLAN.md` — original architecture plan that defined the target split and migration order

### Existing implementation seams
- `src/ai/client.ts` — current combined AI client contracts, adapters, parsing, and factory
- `src/ai/tools.ts` — current combined tool taxonomy, prompt, catalog, and inline execution
- `src/ai/loop.ts` — current combined orchestration, grounding, validation, and policy
- `src/hsm/machine.ts` — HSM consumer of `runAgentTurn` and `PendingExecution`
- `src/hsm/context.ts` — HSM context contract that currently imports `PendingExecution`

### Regression gates
- `src/tests/core/ChatClient.test.ts` — protects client parsing and factory behavior
- `src/tests/ai/windowRuntime.test.ts` — protects inline window and inventory execution behavior
- `src/tests/ai/agentLoop.test.ts` — protects loop orchestration, grounding, and validation behavior

</canonical_refs>

<specifics>
## Specific Ideas

- Use four executable plans:
  - `01-01`: AI client extraction
  - `01-02`: tools split
  - `01-03`: loop split
  - `01-04`: import cleanup and full verification
- Use three waves:
  - Wave 1: `01-01`, `01-02`
  - Wave 2: `01-03`
  - Wave 3: `01-04`

</specifics>

<deferred>
## Deferred Ideas

- Add dedicated unit tests for pure grounding and validation modules after the structural split lands.
- Revisit deeper HSM/AI contract cleanup after this refactor wave proves stable.

</deferred>

---

*Phase: 01-ai-subsystem-refactor*
*Context gathered: 2026-04-10 via bootstrap from `.planning/phases/PLAN.md`*
