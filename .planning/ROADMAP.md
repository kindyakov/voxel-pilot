# Roadmap: VoxelPilot

## Overview

This roadmap defines the first real product milestone for VoxelPilot: an MVP solo-companion runtime that is stable under bad AI output, equipped with a bounded LLM tool surface, backed by persistent memory, and proven in live Minecraft gameplay. The intent is not to chase every future bot feature at once, but to establish a dependable core that can later grow into broader capability families such as farming and building.

## Milestones

- 🚧 **v1.0 MVP Solo Companion Runtime** - Phases 1-5 (current)

## Phases

- [ ] **Phase 1: Runtime Integrity and HSM Recovery** - Make the HSM and runtime failure paths resilient when AI or external systems behave badly.
- [ ] **Phase 2: Bounded Agent Tool Surface** - Ship the MVP LLM tool contract, validation layer, and execution semantics for atomic and complex task tools.
- [ ] **Phase 3: Persistent Memory Reliability** - Make long-lived memory durable, useful, and safely integrated into task execution.
- [ ] **Phase 4: Core Survival Task Execution** - Prove end-to-end gameplay for basic resource gathering and interruption handling.
- [ ] **Phase 5: Combat Assistance and In-Game Acceptance** - Validate combat help and complete milestone-level in-game acceptance.

## Phase Details

### Phase 1: Runtime Integrity and HSM Recovery

**Goal**: Ensure the bot survives invalid LLM output, command interruptions, and runtime failures without corrupting the HSM or crashing the process.
**Depends on**: Nothing (first phase)
**Requirements**: [RT-01, RT-02, RT-03]
**Success Criteria** (what must be TRUE):

1. Invalid or missing AI decisions do not break HSM integrity.
2. Active goals can be cancelled, replaced, or failed cleanly through the runtime contract.
3. Startup, reconnect, and runtime error paths leave the bot recoverable.
   **Plans**: 3 plans

Plans:

- [ ] 01-01: Audit and harden HSM transitions and guardrails around task execution
- [ ] 01-02: Harden command interruption, goal replacement, and failure propagation paths
- [ ] 01-03: Add regression coverage for startup, reconnect, and runtime recovery behavior

### Phase 2: Bounded Agent Tool Surface

**Goal**: Define and harden the MVP tool interface so the agent can act through bounded contracts instead of brittle freeform behavior.
**Depends on**: Phase 1
**Requirements**: [TL-01, TL-02, TL-03]
**Success Criteria** (what must be TRUE):

1. The agent uses only approved OpenAI-compatible tool calls for MVP behavior.
2. Malformed or hallucinated tool invocations are rejected safely and surfaced as structured failures.
3. The runtime supports both atomic tools and bounded higher-level task tools/states with clear ownership.
   **Plans**: 3 plans

Plans:

- [ ] 02-01: Define and verify the MVP tool catalog and tool-call validation contract
- [ ] 02-02: Harden tool execution failure handling, logging, and agent feedback loops
- [ ] 02-03: Introduce or stabilize bounded higher-level task tools/states for multi-step work such as mining

### Phase 3: Persistent Memory Reliability

**Goal**: Make long-lived memory stable across restarts and useful during task execution instead of being passive storage.
**Depends on**: Phase 2
**Requirements**: [MEM-01, MEM-02]
**Success Criteria** (what must be TRUE):

1. Memory survives restart cycles and restores useful execution context.
2. The agent can read and update relevant memory entries during task flow.
3. Memory operations remain bounded and do not destabilize runtime behavior.
   **Plans**: 2 plans

Plans:

- [ ] 03-01: Harden SQLite memory persistence, restoration, and schema-backed access patterns
- [ ] 03-02: Integrate memory read/write paths into the agent loop and verify practical usefulness

### Phase 4: Core Survival Task Execution

**Goal**: Prove that the bot can complete basic solo-survival helper tasks end-to-end in live gameplay.
**Depends on**: Phase 3
**Requirements**: [GP-01, GP-02]
**Success Criteria** (what must be TRUE):

1. The bot can gather basic resources end-to-end in a real game session.
2. The bot handles common task interruptions such as low food, full inventory, and tool availability problems.
3. Task execution remains responsive without collapsing back into brittle manual micromanagement.
   **Plans**: 3 plans

Plans:

- [ ] 04-01: Implement and verify the end-to-end mining/resource-gathering flow
- [ ] 04-02: Handle interruption cases for food risk, inventory pressure, and tool continuity
- [ ] 04-03: Add focused tests plus repeatable in-game validation scenarios for core survival tasks

### Phase 5: Combat Assistance and In-Game Acceptance

**Goal**: Validate combat help and complete full MVP acceptance in real gameplay.
**Depends on**: Phase 4
**Requirements**: [GP-03, VR-01]
**Success Criteria** (what must be TRUE):

1. The bot can defend itself and assist the player in combat without permanently breaking task flow.
2. MVP acceptance is based on both targeted tests and live in-game runs.
3. The milestone ends with a stable, publicly understandable MVP scope rather than an unbounded wishlist.
   **Plans**: 2 plans

Plans:

- [ ] 05-01: Harden combat-assistance integration with the task runtime and player-help scenarios
- [ ] 05-02: Run milestone-level in-game acceptance, capture failures, and close MVP gaps

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase                                       | Milestone | Plans Complete | Status      | Completed |
| ------------------------------------------- | --------- | -------------- | ----------- | --------- |
| 1. Runtime Integrity and HSM Recovery       | v1.0      | 0/3            | Not started | -         |
| 2. Bounded Agent Tool Surface               | v1.0      | 0/3            | Not started | -         |
| 3. Persistent Memory Reliability            | v1.0      | 0/2            | Not started | -         |
| 4. Core Survival Task Execution             | v1.0      | 0/3            | Not started | -         |
| 5. Combat Assistance and In-Game Acceptance | v1.0      | 0/2            | Not started | -         |
