# Validation Guide

Трёхуровневая система валидации планов и задач.

---

## Проблема

План может быть невалидным:

- ❌ Нет кирки для добычи железа
- ❌ Нет печи для плавки
- ❌ Инвентарь полон
- ❌ Нет материалов для крафта

**Решение:** Валидация на 3 уровнях + автоисправление

---

## Уровни валидации

```
┌───────────────────────────────────────┐
│ 1. PRECONDITIONS (Task Registry)     │
│    Статическая проверка в canExecute  │
└───────────────┬───────────────────────┘
                ↓
┌───────────────────────────────────────┐
│ 2. PLAN VALIDATION                    │
│    Проверка всего плана перед стартом│
└───────────────┬───────────────────────┘
                ↓
┌───────────────────────────────────────┐
│ 3. RUNTIME CHECKS                     │
│    Динамическая проверка в состоянии │
└───────────────────────────────────────┘
```

---

## Level 1: Preconditions

### Где

В `TASK_REGISTRY` для каждой задачи.

### Что проверяет

```typescript
canExecute(bot, params) → {
  valid: boolean,
  missing: string[],
  suggestions: Array<Suggestion>
}
```

### Пример для MINING

**Проверяет:**

- ✅ Есть инструмент (кирка)
- ✅ Есть место в инвентаре

**Возвращает:**

```json
{
	"valid": false,
	"missing": ["pickaxe", "inventory_space"],
	"suggestions": [
		{
			"action": "CRAFTING",
			"params": { "recipe": "wooden_pickaxe", "count": 1 }
		},
		{
			"action": "DEPOSIT_ITEMS",
			"params": { "keep_tools": true }
		}
	]
}
```

### Пример для SMELTING

**Проверяет:**

- ✅ Печь поблизости (радиус 64)
- ✅ Есть руда
- ✅ Есть топливо

**Возвращает suggestions:**

- "Построить печь" (если нет)
- "Добыть руду" (если нет)
- "Добыть уголь" (если нет топлива)

---

## Level 2: Plan Validation

### Где

В `src/hsm/helpers/validatePlan.js`

### Когда

Перед стартом выполнения в `PLAN_EXECUTOR.VALIDATING`

### Что проверяет

1. **Формат плана:**
   - Есть `goal`
   - Есть `tasks` (массив)

2. **Каждая задача:**
   - `task.type` существует в `TASK_REGISTRY`
   - Все `required_params` присутствуют
   - `canExecute()` возвращает `valid: true`

3. **Зависимости между задачами:**
   - SMELTING после MINING той же руды - ✅
   - SMELTING без добычи руды - ⚠️ WARNING

### Результат

```typescript
interface ValidationResult {
	valid: boolean
	errors: Array<{
		taskIndex: number
		type: string
		message: string
		suggestions?: Suggestion[]
	}>
	warnings: Array<{
		taskIndex: number
		message: string
	}>
}
```

### Пример валидации

**План:**

```json
{
	"goal": "craft_iron_pickaxe",
	"tasks": [
		{ "type": "MINING", "params": { "ore": "iron_ore", "count": 3 } },
		{ "type": "SMELTING", "params": { "input": "iron_ore", "count": 3 } }
	]
}
```

**Результат:**

```json
{
	"valid": false,
	"errors": [
		{
			"taskIndex": 0,
			"type": "PRECONDITIONS_FAILED",
			"message": "Task MINING cannot execute",
			"missing": ["pickaxe"],
			"suggestions": [
				{ "action": "CRAFTING", "params": { "recipe": "wooden_pickaxe" } }
			]
		},
		{
			"taskIndex": 1,
			"type": "PRECONDITIONS_FAILED",
			"message": "Task SMELTING cannot execute",
			"missing": ["furnace_nearby", "fuel"],
			"suggestions": [
				{ "action": "BUILDING", "params": { "structure": "furnace" } },
				{ "action": "MINING", "params": { "ore": "coal", "count": 1 } }
			]
		}
	],
	"warnings": []
}
```

---

## Level 3: Runtime Checks

### Где

В Task Orchestrator, подсостояние `CHECKING_PRECONDITIONS`

### Когда

**При входе в задачу** перед началом работы

### Что делает

```javascript
MINING: {
  initial: 'CHECKING_PRECONDITIONS',

  states: {
    CHECKING_PRECONDITIONS: {
      always: [
        {
          target: 'REQUESTING_TOOL',
          guard: ({ context }) => !context.bot.utils.getMeleeWeapon()
        },
        {
          target: 'REQUESTING_INVENTORY_SPACE',
          guard: ({ context }) => context.bot.inventory.emptySlotCount() === 0
        },
        {
          target: 'SEARCHING'  // Всё ОК
        }
      ]
    },

    REQUESTING_TOOL: {
      // Создать подзадачу или завершить с ошибкой
    },

    SEARCHING: { /* ... */ }
  }
}
```

### Варианты действий

**1. Создать подзадачу:**

```javascript
REQUESTING_TOOL: {
  entry: ({ context }) => {
    // Вставляем задачу в план ПЕРЕД текущей
    context.bot.hsm.actor.send({
      type: 'INSERT_TASK',
      task: {
        type: 'CRAFTING',
        params: { recipe: 'wooden_pickaxe', count: 1 }
      },
      insertBefore: context.plan.currentIndex
    })
  },
  always: {
    target: '#PLAN_EXECUTOR.PAUSED'
  }
}
```

**2. Завершить с ошибкой:**

```javascript
REQUESTING_TOOL: {
  entry: () => {
    console.error('❌ Нет инструмента и не могу создать')
  },
  always: {
    target: '#TASK_FAILED'
  }
}
```

---

## Автоисправление планов

### Концепция

Использовать `suggestions` из `canExecute()` для автоматического дополнения плана.

### Алгоритм

```
1. Валидация плана
2. Если errors.length > 0:
   a. Собрать все suggestions
   b. Вставить задачи ПЕРЕД проблемными
   c. Повторить валидацию
3. Если valid = true:
   → Исправленный план
4. Иначе:
   → Ошибка (не удалось исправить)
```

### Файл

**`src/hsm/helpers/fixPlan.js`**

Функция `fixPlan(plan, bot, validationResult)` возвращает:

```typescript
{
  ...plan,
  tasks: fixedTasks,        // Дополненный список
  wasFixed: true,
  originalTasks: plan.tasks // Оригинал
}
```

### Пример

**Исходный план:**

```json
{
	"tasks": [{ "type": "MINING", "params": { "ore": "iron_ore", "count": 3 } }]
}
```

**После автофикса:**

```json
{
	"tasks": [
		{
			"type": "CRAFTING",
			"params": { "recipe": "wooden_pickaxe", "count": 1 }
		},
		{ "type": "MINING", "params": { "ore": "iron_ore", "count": 3 } }
	],
	"wasFixed": true
}
```

---

## Workflow валидации

```
PLAN_EXECUTOR
  ↓
VALIDATING
  ↓
validatePlan(plan, bot)
  ├── valid = true
  │   └── → EXECUTING_TASK
  │
  └── valid = false
      ↓
    AUTO_FIXING (если allowAutoFix)
      ↓
    fixPlan(plan, validationResult)
      ↓
    validatePlan(fixedPlan, bot)
      ├── valid = true
      │   └── → EXECUTING_TASK
      └── valid = false
          └── → VALIDATION_FAILED
```

---

## State в HSM

```javascript
PLAN_EXECUTOR: {
  states: {
    VALIDATING: {
      entry: ({ context }) => {
        const validation = validatePlan(context.plan, context.bot)
        console.log('Валидация:', validation)
      },
      always: [
        {
          target: 'VALIDATION_FAILED',
          guard: ({ context }) =>
            !validatePlan(context.plan, context.bot).valid
        },
        { target: 'EXECUTING_TASK' }
      ]
    },

    VALIDATION_FAILED: {
      always: [
        {
          target: 'AUTO_FIXING',
          guard: ({ context }) => context.plan.allowAutoFix !== false
        },
        { target: '#IDLE' }
      ]
    },

    AUTO_FIXING: {
      entry: ({ context }) => {
        const validation = validatePlan(context.plan, context.bot)
        context.plan = fixPlan(context.plan, context.bot, validation)
      },
      always: { target: 'VALIDATING' }
    }
  }
}
```

---

## Таблица проверок

| Проверка             | Level 1 | Level 2 | Level 3 |
| -------------------- | ------- | ------- | ------- |
| Формат плана         | ❌      | ✅      | ❌      |
| Task type существует | ❌      | ✅      | ❌      |
| Required params      | ❌      | ✅      | ❌      |
| Инструмент           | ✅      | ✅      | ✅      |
| Инвентарь            | ✅      | ✅      | ✅      |
| Печь рядом           | ✅      | ✅      | ✅      |
| Материалы            | ✅      | ✅      | ✅      |
| Зависимости задач    | ❌      | ✅      | ❌      |
| Динамические условия | ❌      | ❌      | ✅      |

---

## Дополнительные проверки

### Проверка опыта

Можно добавить в `canExecute`:

```typescript
canExecute: ({ bot, params, memory }) => {
	// Обычные проверки...

	// Проверка опыта
	const exp = memory.experience.tasksCompleted[params.ore]
	if (exp && exp.successRate < 0.5) {
		return {
			valid: false,
			missing: ['experience'],
			suggestions: [
				{
					action: 'MINING',
					params: { ore: 'easier_block', count: 10 }
				}
			]
		}
	}
}
```

### Проверка времени

```typescript
canExecute: ({ bot, params }) => {
	// Ночь и добываем снаружи
	if (bot.time.timeOfDay > 13000 && params.depth > 60) {
		return {
			valid: false,
			missing: ['daylight'],
			suggestions: [
				{
					action: 'WAIT_FOR_DAY',
					params: {}
				}
			]
		}
	}
}
```

---

## Файлы

1. **`src/hsm/helpers/validatePlan.js`**
   - Функция `validatePlan(plan, bot)`
   - Проверка формата, task types, params, preconditions
   - Проверка зависимостей между задачами

2. **`src/hsm/helpers/fixPlan.js`**
   - Функция `fixPlan(plan, bot, validationResult)`
   - Вставка suggestions перед проблемными задачами
   - Возврат исправленного плана

3. **`src/hsm/tasks/registry.js`**
   - `TASK_REGISTRY` с `canExecute` для каждой задачи

---

## Итог

**Преимущества трёхуровневой валидации:**

- ✅ Меньше ошибок во время выполнения
- ✅ AI создаёт более умные планы
- ✅ Автоматическое исправление невалидных планов
- ✅ Бот знает что ему нужно перед началом
- ✅ Graceful degradation (можно создать подзадачу)
