# Project Subagents Hardening Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add project-scoped Codex subagents that improve reliability review, HSM tracing, library verification, test authoring, and narrow hardening work for this repository.

**Architecture:** Keep the agent set intentionally small and opinionated. Use read-only agents for mapping, review, and library verification; reserve workspace-write only for test creation and implementation work. Store everything under `.codex/` so the setup stays project-scoped and versioned.

**Tech Stack:** Codex custom agents, TOML config, TypeScript/Mineflayer/XState repository context.

---

### Task 1: Add project-level agent config

**Files:**
- Create: `.codex/config.toml`

**Step 1:** Add `[agents]` configuration with conservative defaults.

**Step 2:** Set `max_threads = 6` and `max_depth = 1`.

**Step 3:** Verify the file is valid TOML and project-scoped.

### Task 2: Add read-only analysis agents

**Files:**
- Create: `.codex/agents/hsm-mapper.toml`
- Create: `.codex/agents/reviewer-hardline.toml`
- Create: `.codex/agents/mineflayer-archivist.toml`

**Step 1:** Define names, descriptions, nicknames, and read-only sandbox policy.

**Step 2:** Write developer instructions that constrain each agent to a single responsibility.

**Step 3:** Encode repository-specific guidance around HSM flow, reliability review, and external library verification.

### Task 3: Add write-capable execution agents

**Files:**
- Create: `.codex/agents/test-writer.toml`
- Create: `.codex/agents/hardening-worker.toml`

**Step 1:** Configure code-oriented models and `workspace-write`.

**Step 2:** Keep instructions narrow so `test_writer` focuses on regression tests and `hardening_worker` focuses on minimal root-cause fixes.

**Step 3:** Prevent both agents from drifting into unrelated refactors.

### Task 4: Document the setup

**Files:**
- Create: `docs/plans/2026-03-20-subagents-hardening-plan.md`

**Step 1:** Save the rationale and exact files added.

**Step 2:** Make the plan explicit so later maintenance does not depend on chat history.

