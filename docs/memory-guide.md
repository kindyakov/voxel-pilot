# Memory Guide

Система долговременной памяти бота для сохранения знаний между сессиями.

---

## Концепция

### Два типа памяти

```
┌─────────────────────────────────────┐
│ SHORT-TERM (Context)                │
│ - В оперативной памяти             │
│ - Текущая сессия                   │
│ - Быстрый доступ                   │
│ - Очищается при перезапуске        │
│                                     │
│ health, enemies, position, plan    │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ LONG-TERM (File)                    │
│ - На диске (JSON)                  │
│ - Между сессиями                   │
│ - Медленный доступ                 │
│ - Сохраняется навсегда             │
│                                     │
│ knownLocations, experience, stats  │
└─────────────────────────────────────┘
```

---

## Структура долговременной памяти

### Файл

`data/bot_memory.json`

### Схема

```typescript
interface BotMemory {
	meta: {
		botName: string
		createdAt: string
		lastUpdated: string
		version: string
	}

	world: {
		knownLocations: {
			home?: Vec3
			spawn?: Vec3
			chests: Array<ChestLocation>
			resources: Array<ResourceLocation>
		}
		knownPlayers: Map<username, PlayerInfo>
	}

	experience: {
		tasksCompleted: Map<taskType, TaskStats>
		deaths: Array<DeathRecord>
		achievements: Array<Achievement>
	}

	goals: {
		current?: CurrentGoal
		completed: Array<CompletedGoal>
		failed: Array<FailedGoal>
	}

	preferences: {
		favoriteTools: string[]
		avoidAreas: Vec3[]
		preferredMiningDepth: number
	}

	stats: {
		totalPlaytime: number
		blocksMined: Map<blockType, count>
		blocksPlaced: Map<blockType, count>
		itemsCrafted: Map<itemType, count>
		mobsKilled: Map<mobType, count>
		distanceTraveled: number
	}
}
```

---

## Разделы памяти

### 1. world.knownLocations

**Что хранит:**

- Дом бота (`home`)
- Точка спауна (`spawn`)
- Сундуки, печи, верстаки (`chests`)
- Места добычи ресурсов (`resources`)

**Структура:**

```typescript
interface ChestLocation {
	position: Vec3
	type: 'chest' | 'furnace' | 'crafting_table'
	contents?: string[]
	lastChecked: string
}

interface ResourceLocation {
	type: string // 'iron_ore', 'coal', etc.
	position: Vec3
	discovered: string
}
```

**Использование:**

- Найти ближайший известный сундук
- Вспомнить где видел руду
- Вернуться домой

---

### 2. world.knownPlayers

**Что хранит:**

- Список встреченных игроков
- Отношения (дружелюбный/враждебный)
- История взаимодействий

**Структура:**

```typescript
interface PlayerInfo {
	firstMet: string
	lastSeen: string
	interactions: number
	friendly: boolean
	notes: string[]
}
```

**Использование:**

- Узнать игрока при встрече
- Определить кому доверять
- История отношений

---

### 3. experience.tasksCompleted

**Что хранит:**

- Статистика выполнения каждой задачи
- Процент успеха
- Среднее время выполнения

**Структура:**

```typescript
interface TaskStats {
	count: number
	successRate: number // 0.0 - 1.0
	averageTime: number // milliseconds
	lastCompleted: string
}
```

**Использование:**

- Оценка сложности задачи
- Выбор стратегии (если низкий success rate - нужна подготовка)
- Прогнозирование времени выполнения

---

### 4. experience.deaths

**Что хранит:**

- История смертей
- Причины
- Извлечённые уроки

**Структура:**

```typescript
interface DeathRecord {
	timestamp: string
	cause: string
	location: Vec3
	lesson?: string
}
```

**Использование:**

- Избегать опасных мест
- Учиться на ошибках
- Анализ паттернов смертей

---

### 5. goals (текущие и прошлые цели)

**Что хранит:**

- Текущий план (если прерван)
- История выполненных целей
- История проваленных целей

**Использование:**

- Возобновление прерванного плана
- Анализ успешности целей
- Долгосрочное планирование

---

### 6. stats (статистика)

**Что хранит:**

- Количество добытых блоков
- Количество установленных блоков
- Скрафченные предметы
- Убитые мобы
- Пройденное расстояние
- Общее время игры

**Использование:**

- Достижения
- Анализ активности
- Прогресс бота

---

## API памяти

### Класс BotMemory

**Файл:** `src/core/memory.js`

**Методы:**

| Метод                               | Описание                        | Параметры                    |
| ----------------------------------- | ------------------------------- | ---------------------------- |
| `load()`                            | Загрузить из файла              | -                            |
| `save()`                            | Сохранить в файл                | -                            |
| `rememberLocation(type, pos, meta)` | Запомнить место                 | type, position, metadata     |
| `findNearestKnown(type, pos)`       | Найти ближайшее известное место | type, current position       |
| `rememberPlayer(username, meta)`    | Запомнить игрока                | username, metadata           |
| `rememberTask(type, success, time)` | Запомнить задачу                | task type, success, duration |
| `rememberDeath(cause, pos, lesson)` | Запомнить смерть                | cause, location, lesson      |
| `updateStats(type, item, count)`    | Обновить статистику             | type, item, count            |

---

## Lifecycle памяти

```
1. Bot Start
   ↓
2. BotMemory.load()
   ├── Файл существует → Загрузить
   └── Файл не существует → Создать пустую память
   ↓
3. Инициализация HSM Context
   - Скопировать нужные данные из memory в context
   ↓
4. Runtime
   - Использование памяти через bot.hsm.memory
   - Автосохранение каждые 5 минут
   ↓
5. Bot Stop / SIGINT
   ↓
6. BotMemory.save()
   - Сохранить последние изменения
```

---

## Использование в примитивах

### Пример: primitiveSearchBlock с памятью

```
1. onStart
   ├── Проверить bot.hsm.memory.findNearestKnown(blockType, pos)
   ├── Если найдено рядом (< 32 блоков)
   │   └── Сразу отправить FOUND с сохранённой позицией
   └── Иначе
       └── Искать в мире

2. onTick (если не найдено в памяти)
   ├── bot.findBlock(...)
   └── Если нашли
       ├── bot.hsm.memory.rememberLocation(blockType, position)
       └── sendBack(FOUND)
```

**Преимущества:**

- Меньше поиска (если помним где блок)
- Быстрее выполнение
- Накопление знаний о мире

---

## Использование в Task Orchestrators

### Запоминание прогресса

```javascript
MINING: {
	exit: assign({
		// Сохранить прогресс при прерывании
		savedTaskState: ({ context }) => ({
			type: 'MINING',
			progress: context.taskData.progress,
			timestamp: Date.now()
		})
	})
}
```

### Статистика задач

```javascript
TASK_COMPLETED: {
	entry: ({ context }) => {
		const duration = Date.now() - context.taskData.startTime
		bot.hsm.memory.rememberTask(
			context.taskData.type,
			true, // success
			duration
		)
	}
}
```

---

## Автосохранение

### Интервал

Каждые **5 минут** автоматическое сохранение.

### При событиях

- **Смерть** → сохранить запись о смерти
- **Завершение задачи** → сохранить статистику
- **Нахождение важного места** → сохранить локацию
- **Выход (SIGINT)** → финальное сохранение

### Реализация

**В `src/core/hsm.js`:**

```javascript
setupMemory() {
  // Автосохранение каждые 5 минут
  this.saveInterval = setInterval(() => {
    this.memory.save()
  }, 5 * 60 * 1000)

  // При выходе
  process.on('SIGINT', async () => {
    await this.memory.save()
    process.exit(0)
  })
}
```

---

## Интеграция в Context

### При инициализации HSM

```javascript
async init() {
  // Загружаем память
  await this.memory.load()

  // Копируем нужные данные в context
  this.actor = createActor(this.machine, {
    input: {
      bot: this.bot,
      memory: this.memory,

      // Данные из долговременной памяти
      knownChests: this.memory.memory.world.knownLocations.chests,
      knownResources: this.memory.memory.world.knownLocations.resources,
      preferences: this.memory.memory.preferences
    }
  })
}
```

---

## Примеры данных

### Пример файла памяти

```json
{
	"meta": {
		"botName": "TestBot",
		"createdAt": "2025-10-04T12:00:00Z",
		"lastUpdated": "2025-10-04T14:30:00Z",
		"version": "1.0.0"
	},
	"world": {
		"knownLocations": {
			"home": { "x": 100, "y": 64, "z": 200 },
			"chests": [
				{
					"position": { "x": 95, "y": 64, "z": 205 },
					"type": "chest",
					"contents": ["tools", "materials"],
					"discovered": "2025-10-04T12:15:00Z"
				}
			],
			"resources": [
				{
					"type": "iron_ore",
					"position": { "x": 50, "y": 12, "z": 150 },
					"discovered": "2025-10-04T13:00:00Z"
				}
			]
		},
		"knownPlayers": {
			"Player123": {
				"firstMet": "2025-10-04T12:00:00Z",
				"lastSeen": "2025-10-04T14:00:00Z",
				"interactions": 15,
				"friendly": true,
				"notes": ["Gave me diamonds"]
			}
		}
	},
	"experience": {
		"tasksCompleted": {
			"MINING": {
				"count": 25,
				"successRate": 0.92,
				"averageTime": 45000,
				"lastCompleted": "2025-10-04T14:20:00Z"
			}
		},
		"deaths": [
			{
				"timestamp": "2025-10-04T13:30:00Z",
				"cause": "zombie",
				"location": { "x": 75, "y": 64, "z": 180 },
				"lesson": "Don't go out at night without armor"
			}
		]
	},
	"stats": {
		"blocksMined": {
			"iron_ore": 48,
			"coal": 32
		},
		"distanceTraveled": 5420
	}
}
```

---

## Расширение системы

### Дополнительные разделы

- `relationships` - сложные отношения с игроками
- `quests` - квесты от игроков
- `economy` - торговля, цены
- `map` - карта исследованного мира

### Аналитика

- `patterns` - паттерны поведения (когда чаще умирает, какие задачи чаще провалит)
- `predictions` - прогнозы (сколько времени займёт задача)

---

## Итог

**Преимущества Long-term Memory:**

- ✅ Знания сохраняются между сессиями
- ✅ Бот становится умнее со временем
- ✅ Меньше повторной работы (помнит где что)
- ✅ История для анализа и улучшений
- ✅ Персонализация поведения

**Файлы:**

- `src/core/memory.js` - Класс BotMemory
- `data/bot_memory.json` - Файл с данными
