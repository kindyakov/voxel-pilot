# Tasks Guide

Описание Task Orchestrators - состояний HSM, управляющих последовательностью примитивов.

---

## Концепция

**Task Orchestrator** = состояние HSM, которое:

- Управляет последовательностью примитивов
- Знает о цели задачи
- Имеет подсостояния (SEARCHING, NAVIGATING, etc.)
- Каждое подсостояние вызывает примитив через `invoke`
- Сохраняет прогресс в `context.taskData`

---

## Список задач

| Task            | Описание          | Примитивы                           | Сложность |
| --------------- | ----------------- | ----------------------------------- | --------- |
| `MINING`        | Добыча блоков     | search → navigate → break           | ⭐⭐      |
| `SMELTING`      | Плавка в печи     | search → navigate → open → interact | ⭐⭐⭐    |
| `CRAFTING`      | Крафт предметов   | search → navigate → open → craft    | ⭐⭐      |
| `BUILDING`      | Строительство     | navigate → place (цикл)             | ⭐⭐⭐    |
| `DEPOSIT_ITEMS` | Выгрузка в сундук | search → navigate → open → interact | ⭐⭐      |

---

## Структура Task Orchestrator

### HSM State с подсостояниями

```javascript
MINING: {
  initial: 'CHECKING_PRECONDITIONS',

  entry: assign(({ input }) => ({
    taskData: {
      targetBlock: input.taskParams.ore,
      targetCount: input.taskParams.count,
      progress: { found: 0, currentBlock: null }
    }
  })),

  states: {
    CHECKING_PRECONDITIONS: { /* ... */ },
    SEARCHING: {
      invoke: { src: 'primitiveSearchBlock' }
    },
    NAVIGATING: {
      invoke: { src: 'primitiveNavigating' }
    },
    BREAKING: {
      invoke: { src: 'primitiveBreaking' }
    },
    CHECKING_GOAL: { /* ... */ }
  },

  exit: assign({ savedTaskState: /* сохранить прогресс */ })
}
```

---

## MINING - детальная схема

```
MINING
├── CHECKING_PRECONDITIONS
│   ├── Проверка инструмента
│   ├── Проверка места в инвентаре
│   └── → SEARCHING или → REQUESTING_TOOL
│
├── SEARCHING
│   ├── invoke: primitiveSearchBlock
│   │   input: { blockName, maxDistance }
│   └── events:
│       ├── FOUND → NAVIGATING
│       └── NOT_FOUND → TASK_FAILED
│
├── NAVIGATING
│   ├── invoke: primitiveNavigating
│   │   input: { target: currentBlock.position }
│   └── events:
│       ├── ARRIVED → BREAKING
│       └── NAVIGATION_FAILED → SEARCHING
│
├── BREAKING
│   ├── invoke: primitiveBreaking
│   │   input: { block: currentBlock }
│   └── events:
│       ├── BROKEN → progress.found++ → CHECKING_GOAL
│       └── BREAKING_FAILED → SEARCHING
│
└── CHECKING_GOAL
    ├── if progress.found >= targetCount
    │   └── → TASK_COMPLETED
    └── else
        └── → SEARCHING
```

---

## Предусловия (Preconditions)

### Зачем нужны

Проверить **перед началом** задачи:

- Есть ли нужный инструмент
- Есть ли место в инвентаре
- Есть ли поблизости необходимые блоки (печь, верстак)

### Структура в Registry

```typescript
interface TaskDefinition {
	name: string
	description: string
	required_params: string[]
	optional_params: string[]
	primitives_used: string[]

	preconditions: {
		tool?: string
		inventory_space?: boolean
		furnace?: 'nearby'
		// ...
	}

	canExecute: (
		bot,
		params
	) => {
		valid: boolean
		missing: string[]
		suggestions: Array<{
			action: string
			params: object
		}>
	}
}
```

### Пример для MINING

```typescript
MINING: {
  preconditions: {
    tool: 'pickaxe',
    inventory_space: true
  },

  canExecute: ({ bot, params }) => {
    const hasTool = bot.utils.getMeleeWeapon() !== null
    const hasSpace = bot.inventory.emptySlotCount() >= 1

    return {
      valid: hasTool && hasSpace,
      missing: [
        !hasTool && 'pickaxe',
        !hasSpace && 'inventory_space'
      ].filter(Boolean),
      suggestions: [
        !hasTool && {
          action: 'CRAFTING',
          params: { recipe: 'wooden_pickaxe', count: 1 }
        }
      ].filter(Boolean)
    }
  }
}
```

---

## Таблица задач

### MINING

| Параметр      | Тип    | Обязательный | Описание                    |
| ------------- | ------ | ------------ | --------------------------- |
| `blockName`   | string | ✅           | Тип блока для добычи        |
| `count`       | number | ✅           | Количество                  |
| `maxDistance` | number | ❌           | Радиус поиска (default: 32) |

**Предусловия:**

- Инструмент для добычи (кирка)
- Место в инвентаре (минимум 1 слот)

**Последовательность:**

1. Поиск блока (`primitiveSearchBlock`)
2. Навигация (`primitiveNavigating`)
3. Ломание (`primitiveBreaking`)
4. Повтор до достижения `count`

---

### SMELTING

| Параметр | Тип    | Обязательный | Описание                              |
| -------- | ------ | ------------ | ------------------------------------- |
| `input`  | string | ✅           | Что плавить (например, "iron_ore")    |
| `output` | string | ✅           | Что получить (например, "iron_ingot") |
| `count`  | number | ✅           | Количество                            |
| `fuel`   | string | ❌           | Топливо (default: "coal")             |

**Предусловия:**

- Печь поблизости (радиус 64 блока)
- Есть руда для плавки
- Есть топливо

**Последовательность:**

1. Поиск печи (`primitiveSearchBlock`)
2. Навигация к печи
3. Открытие печи (`primitiveOpenContainer`)
4. Взаимодействие - загрузка руды и топлива
5. Ожидание плавки
6. Взятие результата

---

### CRAFTING

| Параметр        | Тип     | Обязательный | Описание                |
| --------------- | ------- | ------------ | ----------------------- |
| `recipe`        | string  | ✅           | Название предмета       |
| `count`         | number  | ✅           | Количество              |
| `craftingTable` | boolean | ❌           | Нужен ли верстак (auto) |

**Предусловия:**

- Есть материалы для крафта
- Верстак поблизости (если нужен)

**Последовательность:**

1. (Опционально) Поиск верстака
2. Навигация к верстаку
3. Открытие верстака
4. Крафт (`primitiveCraft`)

---

### BUILDING

| Параметр    | Тип    | Обязательный | Описание                   |
| ----------- | ------ | ------------ | -------------------------- |
| `structure` | string | ✅           | Название структуры         |
| `location`  | Vec3   | ✅           | Позиция строительства      |
| `blocks`    | array  | ❌           | Список блоков (для custom) |

**Предусловия:**

- Есть блоки в инвентаре

**Последовательность:**

1. Навигация к позиции
2. Установка блоков по схеме (цикл)

---

### DEPOSIT_ITEMS

| Параметр         | Тип      | Обязательный | Описание                             |
| ---------------- | -------- | ------------ | ------------------------------------ |
| `keep_tools`     | boolean  | ❌           | Оставить инструменты (default: true) |
| `keep_food`      | boolean  | ❌           | Оставить еду (default: true)         |
| `specific_items` | string[] | ❌           | Выложить конкретные предметы         |

**Предусловия:**

- Сундук поблизости

**Последовательность:**

1. Поиск сундука
2. Навигация к сундуку
3. Открытие сундука
4. Перекладывание предметов

---

## Registry файл

**Файл:** `src/hsm/tasks/registry.js`

```javascript
export const TASK_REGISTRY = {
	MINING: {
		name: 'MINING',
		description: 'Mine specific blocks',
		required_params: ['ore', 'count'],
		optional_params: ['maxDistance'],
		primitives_used: ['searchBlock', 'navigate', 'break'],
		preconditions: {
			/* ... */
		},
		canExecute: ({ bot, params }) => {
			/* ... */
		},
		events_emitted: ['TASK_COMPLETED', 'TASK_FAILED']
	},

	SMELTING: {
		/* ... */
	},
	CRAFTING: {
		/* ... */
	},
	BUILDING: {
		/* ... */
	},
	DEPOSIT_ITEMS: {
		/* ... */
	}
}
```

**Использование registry:**

- AI знает какие задачи доступны
- Валидация планов
- Автоисправление планов (suggestions)

---

## Runtime Checks

### Концепция

Проверка **во время выполнения** в подсостоянии `CHECKING_PRECONDITIONS`.

**Если не выполнены предусловия:**

1. Переход в `REQUESTING_TOOL` или `REQUESTING_INVENTORY_SPACE`
2. Создание подзадачи (insert task в план)
3. Или выход с ошибкой `TASK_FAILED`

### Схема для MINING

```
CHECKING_PRECONDITIONS:
  ├── if !hasTool
  │   └── → REQUESTING_TOOL
  │       └── Create subtask: CRAFTING (wooden_pickaxe)
  ├── if !hasSpace
  │   └── → REQUESTING_INVENTORY_SPACE
  │       └── Create subtask: DEPOSIT_ITEMS
  └── else
      └── → SEARCHING
```

---

## Расширение системы

### Добавление новой задачи

1. Определить в `TASK_REGISTRY`
2. Создать state в `machine.ts` → `TASKS`
3. Определить подсостояния
4. Связать с примитивами через `invoke`
5. Добавить `canExecute` с предусловиями

### Примеры будущих задач

- `FOLLOW_PLAYER` - следовать за игроком
- `DEFEND_AREA` - защищать территорию
- `EXPLORE` - исследовать мир
- `TRADE` - торговать с жителями
- `FARM_ANIMALS` - разводить животных
