# Requirements: VoxelPilot

**Defined:** 2026-04-14
**Milestone:** MVP Solo Companion Runtime
**Core Value:** The bot must remain functionally useful and structurally intact even when the LLM hallucinates, times out, or returns bad decisions.

## v1 Requirements

### Runtime Integrity

- [ ] **RT-01**: User can give the bot a goal and the HSM remains in a valid state even when the LLM returns malformed, irrelevant, or missing tool output.
- [ ] **RT-02**: User can interrupt, stop, or replace an active goal without leaving orphaned task state or crashing the bot process.
- [ ] **RT-03**: Startup, reconnect, and runtime failure paths leave the bot recoverable instead of silently corrupted.

### Agent Tooling

- [ ] **TL-01**: The agent can use an MVP set of bounded tools through OpenAI-compatible tool calling only; arbitrary freeform action execution is not allowed.
- [ ] **TL-02**: Invalid or hallucinated tool calls are rejected, logged, and returned to the agent loop as structured failures instead of crashing execution.
- [ ] **TL-03**: The runtime supports both atomic tools and bounded higher-level task tools/states so the agent can solve problems without per-step micromanagement.

### Persistent Memory

- [ ] **MEM-01**: The bot persists long-lived memory across restarts in SQLite and restores relevant task context on the next session.
- [ ] **MEM-02**: The agent can read and update memory for locations, containers, resources, danger markers, and goal/task history during execution.

### Gameplay Capability

- [ ] **GP-01**: User can ask the bot to gather basic survival resources end-to-end in live gameplay.
- [ ] **GP-02**: While executing a task, the bot handles common survival interruptions such as low-food risk, full inventory, and missing or broken tools without collapsing the HSM.
- [ ] **GP-03**: The bot can defend itself and help the player in combat without permanently breaking task continuity.

### Verification

- [ ] **VR-01**: MVP subsystems are accepted only after both targeted automated tests and in-game validation scenarios pass.

## v2 Requirements

### Future Capability Families

- **FC-01**: User can delegate farming loops through a dedicated bounded `FARMING` task/state family.
- **FC-02**: User can delegate structured building work through a dedicated bounded `BUILDING` task/state family.

## Out of Scope

| Feature                                              | Reason                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| Multi-agent coordination between several bots        | Too much complexity for MVP runtime hardening                               |
| Real-time web UI / HSM inspector                     | Observability is useful later, but does not unblock MVP gameplay usefulness |
| Broad new macro-state families beyond the MVP set    | Stabilize the runtime contract before adding more behavioral surface        |
| Supporting non-OpenAI-compatible AI providers in MVP | Reduce integration variance while hardening the agent/tool contract         |

## Traceability

| Requirement | Phase   | Status  |
| ----------- | ------- | ------- |
| RT-01       | Phase 1 | Pending |
| RT-02       | Phase 1 | Pending |
| RT-03       | Phase 1 | Pending |
| TL-01       | Phase 2 | Pending |
| TL-02       | Phase 2 | Pending |
| TL-03       | Phase 2 | Pending |
| MEM-01      | Phase 3 | Pending |
| MEM-02      | Phase 3 | Pending |
| GP-01       | Phase 4 | Pending |
| GP-02       | Phase 4 | Pending |
| GP-03       | Phase 5 | Pending |
| VR-01       | Phase 5 | Pending |

**Coverage:**

- v1 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0 ✓

---

_Requirements defined: 2026-04-14_
_Last updated: 2026-04-14 after milestone reset_
