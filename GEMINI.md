# Minecraft Bot Architecture
## Core
- SQLite memory
- HSM XState v5
- AI Loop
## Memory
- SQLite Manager (src/core/memory/index.ts)
## HSM States
- MONITORING (Parallel)
- TASKS (Thinking -> Executing)
- COMBAT
- URGENT_NEEDS
