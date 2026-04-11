# Roadmap: Minecraft Bot AI Refactor

## Overview

This roadmap turns a raw architectural refactor brief into an executable, phase-based GSD program. The first phase focuses on decomposing the overloaded `src/ai` subsystem while preserving runtime behavior, HSM compatibility, and regression coverage.

## Phases

- [x] **Phase 1: AI Subsystem Refactor** - Decompose `src/ai/client.ts`, `src/ai/tools.ts`, and `src/ai/loop.ts` into stable contracts, focused modules, and thin facades. (completed 2026-04-11)

## Phase Details

### Phase 1: AI Subsystem Refactor
**Goal**: Convert the overloaded `src/ai` entry files into thin facades backed by dedicated client, tools, contracts, and loop modules without changing bot behavior.
**Depends on**: Nothing (first phase)
**Requirements**: [ARCH-01, ARCH-02, ARCH-03, ARCH-04]
**Success Criteria** (what must be TRUE):
  1. `src/ai/client.ts`, `src/ai/tools.ts`, and `src/ai/loop.ts` are facade-style entrypoints instead of god files.
  2. The AI client, tool execution, and loop orchestration responsibilities are separated into dedicated modules with stable ownership boundaries.
  3. Existing HSM integration, targeted AI tests, `npm run type-check`, and `npm run build` still pass after execution.
**Plans**: 4 plans

Plans:
- [x] 01-01: Extract AI client contracts, parsers, adapters, and factory
- [x] 01-02: Split AI tools taxonomy, catalog, and inline executors
- [x] 01-03: Split agent loop orchestration, grounding, validation, and policy
- [x] 01-04: Consolidate imports, keep facades thin, and run full regression verification

## Progress

**Execution Order:**
Phases execute in numeric order: 1

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. AI Subsystem Refactor | 4/4 | Complete | 2026-04-11 |
