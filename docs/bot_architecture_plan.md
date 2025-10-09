# Architecture Overview

Высокоуровневое описание архитектуры Minecraft бота с 3-уровневой системой задач.

---

## Общая схема

```
┌──────────────────────────────────────────┐
│ Level 3: PLAN EXECUTOR                   │
│ Управляет последовательностью задач      │
│ Отслеживает прогресс, сохраняет состояние│
└─────────────┬────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────┐
│ Level 2: TASK ORCHESTRATORS              │
│ Управляют последовательностью примитивов │
│ MINING, SMELTING, CRAFTING, BUILDING     │
└─────────────┬────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────┐
│ Level 1: PRIMITIVE SERVICES              │
│ Атомарные действия (actors, не states)  │
│ search, navigate, break, place           │
└──────────────────────────────────────────┘
```

---

## Ключевые принципы

### 1. Separation of Concerns

**Примитивы** = атомарные действия (НЕ знают о задачах)
**Tasks** = последовательности примитивов (знают о цели)
**Plan Executor** = управление последовательностью задач

### 2. Services vs States

❌ **Неправильно:** Примитивы как состояния HSM

```
PRIMITIVE_ACTIONS (state):
  └── SEARCHING (state)
```

✅ **Правильно:** Примитивы как services (actors)

```
TASKS (state):
  └── MINING (state):
      └── SEARCHING (state)
          └── invoke: primitiveSearchBlock (service)
```

### 3. Параметры передаются через `input`

```
Task Orchestrator получает params из плана:
invoke: {
  src: 'taskType',
  input: ({ context }) => ({
    taskParams: context.plan.tasks[N].params
  })
}
```

### 4. Валидация на 3 уровнях

1. **Preconditions** - в Task Registry (статические)
2. **Plan Validation** - перед выполнением (проверка всего плана)
3. **Runtime Checks** - во время выполнения (динамические)

---

## Структура папок

```
src/
├── core/
│   ├── bot.ts              # Класс бота
│   ├── commandHandler.ts   # Обработчик команд
│   ├── hsm.ts              # BotStateMachine
│   └── memory.ts           # BotMemory (persistent)
│
├── hsm/
│   ├── actors/
│   │   ├── primitives.actors.ts    # Services
│   │   ├── combat.actors.ts
│   │   └── index.actors.ts
│   │
│   ├── primitives/
│   │   └── registry.ts             # PRIMITIVE_REGISTRY
│   │
│   ├── tasks/
│   │   └── registry.ts             # TASK_REGISTRY
│   │
│   ├── helpers/
│   │   ├── createStatefulService.ts
│   │   ├── validatePlan.ts
│   │   └── fixPlan.ts
│   │
│   ├── machine.ts                  # HSM states
│   └── context.ts
│
├── ai/
│   ├── prompts/
│   │   └── taskPlanner.ts
│   └── agent.ts
│
└── data/
    └── bot_memory.json             # Долговременная память
```

---

## Формат данных

### Plan Format

```typescript
interface Plan {
	goal: string
	priority: number
	tasks: Task[]
	currentIndex?: number // Для executor
}

interface Task {
	type: string // Из TASK_REGISTRY
	params: object // Параметры задачи
}
```

**Пример:**

```json
{
	"goal": "craft_iron_pickaxe",
	"priority": 6,
	"tasks": [
		{ "type": "MINING", "params": { "ore": "iron_ore", "count": 3 } },
		{ "type": "SMELTING", "params": { "input": "iron_ore", "count": 3 } },
		{ "type": "CRAFTING", "params": { "recipe": "iron_pickaxe", "count": 1 } }
	]
}
```

---

## Workflow выполнения плана

```
1. AI создаёт Plan
   ↓
2. PLAN_EXECUTOR → VALIDATING
   - Проверка что task.type существуют
   - Проверка params
   - Проверка preconditions
   ↓
3. PLAN_EXECUTOR → EXECUTING_TASK
   - invoke: tasks[currentIndex].type
   - input: tasks[currentIndex].params
   ↓
4. Task Orchestrator (MINING)
   - Запускает последовательность примитивов
   - SEARCHING → NAVIGATING → BREAKING
   ↓
5. Primitive Service (primitiveSearchBlock)
   - Выполняет атомарное действие
   - Отправляет FOUND или NOT_FOUND
   ↓
6. Task → TASK_COMPLETED
   ↓
7. PLAN_EXECUTOR → currentIndex++
   ↓
8. Повторяем с шага 3 или → PLAN_COMPLETED
```

---

## Приоритеты и прерывание

```
PRIORITIES:
  EMERGENCY_HEALING: 8    ← может прервать
  EMERGENCY_EATING: 8     ← может прервать
  COMBAT: 7
  PLAN_EXECUTOR: 6        ← может быть прерван
  FOLLOWING: 9
  IDLE: 1
```

**При прерывании:**

- Task сохраняет прогресс в `context.taskData`
- Plan Executor сохраняет `currentIndex` в `context.pausedPlan`
- При возврате через `history` - продолжается с того же места

---

## Memory System

### Два типа памяти

**Short-term (Context):**

- В RAM, текущая сессия
- `context.health`, `context.enemies`, etc.

**Long-term (File):**

- В `data/bot_memory.json`
- Сохраняется между сессиями
- `world.knownLocations`, `experience.tasksCompleted`, `stats`

### API памяти

```javascript
bot.hsm.memory.rememberLocation(type, position, metadata)
bot.hsm.memory.findNearestKnown(type, currentPosition)
bot.hsm.memory.rememberTask(taskType, success, duration)
bot.hsm.memory.updateStats(type, item, count)
```

---

## Связанные документы

1. [Primitives Guide](./primitives-guide.md) - Описание примитивов
2. [Tasks Guide](./tasks-guide.md) - Описание task orchestrators
3. [Validation Guide](./validation-guide.md) - Система валидации
4. [Memory Guide](./memory-guide.md) - Система памяти
5. [Implementation Plan](./implementation-plan.md) - План реализации

---

## Ключевые концепции

### Примитив = Service (Actor)

- Создаётся через `createStatefulService()`
- НЕ является состоянием HSM
- Запускается через `invoke` из Task state
- Имеет lifecycle: `onStart` → `onTick` | `onAsyncTick` | `onEvents` → `onCleanup`

### Task = State с подсостояниями

- Является состоянием HSM
- Имеет подсостояния: SEARCHING, NAVIGATING, BREAKING
- Каждое подсостояние вызывает примитив через `invoke`
- Сохраняет прогресс в `context.taskData`

### Plan Executor = Управляющий state

- Запускает задачи последовательно
- Отслеживает `currentIndex`
- Валидирует план перед стартом
- Сохраняет состояние при прерывании

---

## Следующие шаги

1. Изучить детальные guides (см. связанные документы)
2. Создать структуру папок
3. Реализовать по этапам (см. Implementation Plan)
