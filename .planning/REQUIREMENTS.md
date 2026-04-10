# Requirements: Minecraft Bot AI Refactor

**Defined:** 2026-04-10
**Core Value:** The bot's AI planning and execution behavior must stay stable while the `src/ai` subsystem becomes small enough to change safely.

## v1 Requirements

### Architecture

- [ ] **ARCH-01**: `src/ai/client.ts` becomes a thin facade while contracts, adapters, parsers, and factory ownership move into dedicated modules.
- [ ] **ARCH-02**: `src/ai/tools.ts` becomes a thin facade while tool names, prompt, catalog, shared coercion, and inline executors move into dedicated modules.
- [ ] **ARCH-03**: `src/ai/loop.ts` becomes a thin facade while `runAgentTurn` orchestration, grounding, validation, and loop policy move into dedicated modules.
- [ ] **ARCH-04**: Existing HSM integration, entrypoint imports, tests, type-check, and build behavior remain intact through the refactor.

## v2 Requirements

### Follow-up

- **ARCH-05**: Add dedicated unit tests for pure grounding and validation modules after the structural split lands.
- **ARCH-06**: Reduce remaining `src/hsm` knowledge of `src/ai` internals beyond stable contracts.

## Out of Scope

| Feature | Reason |
|---------|--------|
| New bot tasks or world interactions | This phase is structural, not feature delivery |
| Snapshot redesign | Unnecessary risk during bootstrap |
| Runtime window mechanic changes | Keep execution behavior stable while ownership changes |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ARCH-01 | Phase 1 | Pending |
| ARCH-02 | Phase 1 | Pending |
| ARCH-03 | Phase 1 | Pending |
| ARCH-04 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 4 total
- Mapped to phases: 4
- Unmapped: 0

---
*Requirements defined: 2026-04-10*
*Last updated: 2026-04-10 after initial GSD bootstrap*
