---
phase: 01-ai-subsystem-refactor
plan: 02
subsystem: ai
tags: [tools, catalog, executors, runtime, facade]
requires: []
provides:
  - Dedicated tool taxonomy and execution contracts
  - Inline executor modules for memory, inspect, and window behavior
  - Stable src/ai/tools.ts facade exports
affects: [src/ai/tools.ts, src/ai/loop.ts, src/hsm/context.ts, tests]
tech-stack:
  added: []
  patterns: [tool-catalog, executor-family, thin-facade]
key-files:
  created:
    - src/ai/contracts/execution.ts
    - src/ai/tools/catalog.ts
    - src/ai/tools/names.ts
    - src/ai/tools/prompt.ts
    - src/ai/tools/shared.ts
    - src/ai/tools/summary.ts
    - src/ai/tools/inlineExecutor.ts
    - src/ai/tools/executors/memory.ts
    - src/ai/tools/executors/inspect.ts
    - src/ai/tools/executors/window.ts
  modified:
    - src/ai/tools.ts
    - src/tests/ai/windowRuntime.test.ts
key-decisions:
  - "Execution contracts now live in src/ai/contracts/execution.ts so HSM can depend on stable types without importing the tools facade."
  - "Window, inspect, and memory inline behavior were split by executor family instead of mixing catalog and runtime logic."
patterns-established:
  - "Tool schema ownership is separate from inline execution ownership."
  - "Executor dispatch stays centralized in inlineExecutor.ts while executor modules stay domain-specific."
requirements-completed: [ARCH-02, ARCH-04]
duration: 1 session
completed: 2026-04-11
---

# Phase 01-02 Summary

**Tool names, schema catalog, coercion helpers, and inline runtime execution are now split into focused modules behind a stable `src/ai/tools.ts` facade.**

## Performance

- **Duration:** 1 session
- **Started:** 2026-04-11T10:15:00+03:00
- **Completed:** 2026-04-11T10:55:46+03:00
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments
- Extracted tool-name taxonomy, execution contracts, prompt text, catalog, and execution summary helpers.
- Moved inline runtime behavior into dedicated `memory`, `inspect`, and `window` executor modules.
- Replaced `src/ai/tools.ts` with a facade and added regression coverage for the new module ownership.

## Task Commits

Atomic task commits were not created in this Codex workspace session. Work remains in the local working tree and is verified by tests instead of commit boundaries.

## Files Created/Modified
- `src/ai/contracts/execution.ts` - Stable tool-name and pending-execution contracts.
- `src/ai/tools/catalog.ts` - Agent tool schema catalog.
- `src/ai/tools/names.ts` - Tool name classifiers and sets.
- `src/ai/tools/prompt.ts` - System prompt ownership.
- `src/ai/tools/shared.ts` - Shared coercion and schema helpers.
- `src/ai/tools/summary.ts` - Execution summary strings.
- `src/ai/tools/inlineExecutor.ts` - Inline executor dispatcher.
- `src/ai/tools/executors/*.ts` - Memory, inspect, and window execution families.
- `src/ai/tools.ts` - Thin facade export surface.
- `src/tests/ai/windowRuntime.test.ts` - Module/facade ownership regression coverage.

## Decisions Made

- Kept catalog output and prompt text byte-compatible with the prior single-file implementation.
- Preserved `executeInlineToolCall` result shape while relocating the concrete behavior.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The build/test environment required escalated execution for TypeScript test runs due to sandbox `EPERM` on subprocess spawn.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Loop orchestration can now depend on stable tool contracts and executor modules instead of the old god file.
- HSM-facing execution types are available from a contracts path for final consolidation.

---
*Phase: 01-ai-subsystem-refactor*
*Completed: 2026-04-11*
