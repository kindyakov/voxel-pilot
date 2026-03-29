# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Development (watch mode with tsx)
npm run dev

# Build TypeScript to JavaScript
npm run build

# Type checking (without emitting)
npm run type-check

# Code formatting
npm run format

# Clean build artifacts
npm run clean

# Start the built bot
npm start
```

## Project Overview

This is a **Minecraft bot** using **xstate** (v5) for state management and **mineflayer** for game interaction. The bot uses a two-tier execution loop within the `TASKS` state:

1. **Level 1 (Thinking)**: The `AGENT_LOOP` builds a world snapshot and asks the LLM for a tool decision. Informational (inline) tools execute instantly to update context.
2. **Level 2 (Executing)**: Once an execution tool is chosen, the HSM transitions to a concrete **Primitive Actor** (Navigating, Breaking, Smelting, etc.) to perform the physical action.

## High-Level Architecture

### Core Systems

- **HSM** (`src/hsm/machine.ts`):
  - Parallel machine: `MAIN_ACTIVITY` (Idle, Urgent Needs, Combat, Tasks) and `MONITORING`.
  - `TASKS.THINKING`: Invokes the AI Loop to decide the next step.
  - `TASKS.EXECUTING`: Invokes a primitive actor based on the AI's decision.

- **AI Loop** (`src/ai/loop.ts`):
  - **Snapshot**: Builds a text representation of the bot's state.
  - **Thinking**: Calls OpenAI with available tools.
  - **Tool System** (`src/ai/tools.ts`):
    - *Inline Tools*: Instant info retrieval (memory read, container inspect).
    - *Execution Tools*: Physical actions that trigger HSM transitions.

- **Memory System** (`src/core/memory/`):
  - Long-term memory layer backed by **SQLite** (`better-sqlite3`).
  - Persistent database located at `data/bot_memory_${botName}.db`.
  - Stores spatially indexed entries (locations, containers, resources) and legacy statistics.
  - CRUD operations: `saveEntry`, `readEntries`, `updateEntryData`, `deleteEntry`.
  - Auto-saves metadata every 5 minutes; entries are persisted immediately.
  - **Path**: `data/bot_memory_[name].db`.

### Plugin Architecture
Mineflayer plugins loaded in `src/modules/plugins/index.plugins.ts`: `armorManager`, `autoEat`, `pathfinder`, `pvp`, `movement`, `tool`, `viewer`, `webInventory`, `hawkeye`.

### Primitive Services (Atomic Actions)
Located in `src/hsm/actors/primitives/`. All must support `AbortSignal`.
- `primitiveNavigating`, `primitiveBreaking`, `primitivePlacing`, `primitiveCraft`, `primitiveSmelt`, `primitiveFollowing`, etc.

## Key Architectural Principles

### Cancellability & Safety
- **AbortSignal**: Every primitive MUST accept and respect a `signal` for instant cancellation.
- **Anti-Loop**: `failureRepeats` tracking and `isAgentLoopStuck` guard prevent infinite failure cycles.
- **Context Isolation**: Use HSM context for state; avoid direct `bot.entity` mutations.

### Parameter Flow
```
User Command (Event)
  → HSM transition to TASKS.THINKING
  → AI Loop generates Tool Call (Execution)
  → HSM transition to TASKS.EXECUTING.[State]
  → Primitive Actor invoked with Tool Arguments
```

## TypeScript Configuration
- **Path aliases**: `@/*`, `@/hsm/*`, `@/config/*`, `@/utils/*`, `@/modules/*`, `@/core/*`.
- **Target**: ES2022, Strict mode enabled.

## Memory Structure
- **Meta**: Bot metadata, versions.
- **World**: Locations, Players (interactions, friendliness).
- **Experience**: Task success rates, average durations, death records.
- **Stats**: Mined, placed, crafted, killed counts, distance traveled.

## Common Development Tasks

### Adding a New Physical Capability
1. **Primitive**: Create a new actor in `src/hsm/actors/primitives/`.
2. **Registry**: Register it in `src/hsm/actors/primitives/index.primitive.ts`.
3. **Tool Definition**: Add a `call_[name]` execution tool to `src/ai/tools.ts`.
4. **HSM Update**:
   - Add state to `TASKS.EXECUTING` in `src/hsm/machine.ts`.
   - Add guard (e.g., `is[Name]Execution`).
   - Add logic to `resolveExecutionActor` and `resolveExecutionInput`.

### Adding a New Informational Tool
1. **Tool Definition**: Add a tool to `InlineToolName` and `AGENT_TOOLS` in `src/ai/tools.ts`.
2. **Implementation**: Add logic to `executeInlineToolCall` in `src/ai/tools.ts`.

## Debugging Tips
- Logs: `logs/bot.log` and `logs/error.log`.
- Database: Inspect `data/*.db` with a SQLite viewer.
- Viewer: Access the bot's perspective via `prismarine-viewer` (if enabled).
- Failure Signatures: Check `context.failureSignature` in HSM to see why the AI loop is repeating errors.
