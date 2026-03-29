# Project Overview

This project is a TypeScript-based Minecraft bot that combines Mineflayer automation, an XState v5 hierarchical state machine, and an LLM-driven agent loop.

## Purpose
- Run a Minecraft bot with task execution driven by an agent loop inside the HSM.
- Build deterministic world/task snapshots, ask the configured model for one tool decision, and execute informational or action tools.
- Persist long-term memory through the dedicated SQLite-backed memory manager.

## Tech Stack
- TypeScript with ESM
- Node.js 18+
- Mineflayer and related plugins
- XState v5 for HSM/task orchestration
- OpenAI SDK for model integration
- better-sqlite3 for persistent memory
- Winston for logging

## High-Level Architecture
- `src/index.ts`: runtime entrypoint
- `src/core/`: bot bootstrap, chat command ingestion, HSM wiring, persistent services
- `src/ai/`: LLM agent loop, provider clients, snapshot builder, tool schemas, tool execution helpers
- `src/core/memory/`: SQLite-backed long-term memory manager
- `src/hsm/`: XState machine, primitives, actors, guards, update utilities
- `src/modules/`: Mineflayer plugin wiring
- `src/types/`, `src/config/`, `src/utils/`: shared types, configuration, generic utilities
- `src/tests/`: subsystem tests grouped by `ai`, `core`, `config`, `hsm`
- `data/`: runtime state and SQLite storage
- `logs/`: runtime logs
- `dist/`: compiled output

## Important Architectural Rules
- Do not add ad hoc filesystem persistence for agent memory; use `src/core/memory/` only.
- If memory schema changes are needed, add a real migration path.
- The task system is an `AGENT_LOOP` inside `TASKS` with `IDLE -> THINKING -> EXECUTING`, not hardcoded domain planners.
- Informational tools execute inline; execution tools transition the HSM into concrete primitive states.