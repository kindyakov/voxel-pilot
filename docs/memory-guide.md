# Memory

The bot uses SQLite for long-term memory.
The database file is created per bot name at:

```text
data/bot_memory_<botName>.db
```

`MemoryManager` lives in `src/core/memory/`.

## What Memory Stores

- known locations: home, spawn, chests, furnaces, crafting tables, resources
- known players and interaction notes
- task history and success rates
- deaths and lessons learned
- goal history
- aggregate stats such as mined blocks and distance traveled

## API

The current public API is:

- `load()`
- `save()`
- `close()`
- `saveEntry()`
- `readEntries()`
- `updateEntryData()`
- `deleteEntry()`
- `rememberLocation()`
- `findNearestKnown()`
- `rememberPlayer()`
- `rememberTask()`
- `rememberDeath()`
- `updateStats()`
- `updateDistance()`
- `updatePlaytime()`
- `setCurrentGoal()`
- `completeCurrentGoal()`
- `failCurrentGoal()`
- `getMemory()`
- `getKnownLocations()`
- `getTaskStats()`
- `getStats()`

## Storage Model

The database uses two tables:

- `memory_meta`
- `memory_entries`

`saveEntry()` writes or updates entries immediately.
`save()` updates metadata timestamps.

## Entry Types

`MemoryEntryType` currently supports:

- `container`
- `location`
- `resource`
- `danger`

`rememberLocation()` maps high-level locations into those entry types.
For example:

- `home` and `spawn` become `location`
- `chest` becomes `container`
- `resource` becomes `resource`

## Current Behavior

- entries are deduplicated by type and position
- reads can be filtered by tags and distance
- `getMemory()` derives known locations from stored entries
- schema creation happens during `load()`

## Maintenance Rule

If the schema changes, add a migration path.
Do not add ad hoc JSON files or a second persistence mechanism.
