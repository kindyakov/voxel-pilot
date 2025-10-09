# Primitives Guide

Описание атомарных действий (primitive services) для Minecraft бота.

---

## Концепция

**Primitive Service** = атомарное действие, которое:

- Выполняет одну простую задачу
- НЕ знает о целях и планах
- Является **actor'ом** (service), а НЕ состоянием HSM
- Создаётся через `createStatefulService()`
- Запускается через `invoke` из Task state

---

## Категории примитивов

### 🔍 Поиск (Search)

| Примитив                | Что ищет     | Параметры                               | События              |
| ----------------------- | ------------ | --------------------------------------- | -------------------- |
| `primitiveSearchBlock`  | Блоки в мире | `blockName`, `maxDistance`              | `FOUND`, `NOT_FOUND` |
| `primitiveSearchEntity` | Мобы, игроки | `entityType`, `category`, `maxDistance` | `FOUND`, `NOT_FOUND` |

**category для entities:**

- `'hostile'` - враждебные мобы
- `'passive'` - мирные мобы
- `'player'` - игроки

---

### 🚶 Навигация (Navigation)

| Примитив              | Действие    | Параметры                          | События                        |
| --------------------- | ----------- | ---------------------------------- | ------------------------------ |
| `primitiveNavigating` | Идти к цели | `target` (Vec3/Entity), `distance` | `ARRIVED`, `NAVIGATION_FAILED` |

**target может быть:**

- `Vec3` - координаты
- `Entity` - сущность (моб/игрок)
- `Block` - блок

---

### 🔨 Взаимодействие (Interaction)

| Примитив                 | Действие                | Параметры                             | События                     |
| ------------------------ | ----------------------- | ------------------------------------- | --------------------------- |
| `primitiveBreaking`      | Сломать блок            | `block`                               | `BROKEN`, `BREAKING_FAILED` |
| `primitivePlacing`       | Поставить блок          | `blockName`, `position`, `faceVector` | `PLACED`, `PLACING_FAILED`  |
| `primitiveOpenContainer` | Открыть контейнер       | `container`                           | `OPENED`, `OPENING_FAILED`  |
| `primitiveInteract`      | Взять/положить предметы | `action`, `items`                     | `COMPLETED`, `FAILED`       |

---

### 🛠️ Крафт и плавка (Crafting)

| Примитив         | Действие       | Параметры                | События                      |
| ---------------- | -------------- | ------------------------ | ---------------------------- |
| `primitiveCraft` | Крафт предмета | `recipe`, `count`        | `CRAFTED`, `CRAFTING_FAILED` |
| `primitiveSmelt` | Плавка в печи  | `input`, `fuel`, `count` | `SMELTED`, `SMELTING_FAILED` |

---

## Структура примитива

Примитив создаётся через `createStatefulService()` с параметрами:

```typescript
{
  name: string,              // Название для логов
  tickInterval?: number,     // Интервал проверки (ms)
  initialState?: object,     // Внутреннее состояние
  asyncTickInterval?: number,// Интервал асинхронной проверки (ms)

  onStart?: (api) => void,   // При запуске
  onTick?: (api) => void,    // Каждый tick
  onEvents?: (api) => object,// События bot
  onCleanup?: (api) => void  // При остановке
  onReceive?: (api) => void  // При получении события от HSM
}
```

**API объект:**

```typescript
{
	;(bot, // Mineflayer bot
		context, // Актуальный контекст из HSM
		state, // Внутреннее состояние service
		sendBack, // Отправить событие в HSM
		setState, // Обновить внутреннее состояние
		getContext, // Получить свежий контекст
		abortSignal) // Для отмены async
}
```

---

## Lifecycle примитива

```
Task state → invoke primitiveSearchBlock
    ↓
onStart()     ← Один раз при запуске
    ↓
onTick()      ← Каждые N миллисекунд
    ↓         ← Цикл пока state активен
onTick()
    ↓
sendBack({ type: 'FOUND' })  ← Отправка события
    ↓
Task получает FOUND → переход в другое состояние
    ↓
onCleanup()   ← Автоматически при выходе
```

---

## Registry структура

**Файл:** `src/hsm/primitives/registry.js`

```typescript
interface PrimitiveDefinition {
	name: string // Имя service
	description: string // Описание
	required_params: string[] // Обязательные параметры
	optional_params: string[] // Опциональные параметры
	events_emitted: string[] // Какие события отправляет
}

const PRIMITIVE_REGISTRY = {
	searchBlock: PrimitiveDefinition,
	searchEntity: PrimitiveDefinition,
	navigate: PrimitiveDefinition
	// ...
}
```

**Использование registry:**

- AI знает какие примитивы доступны
- Валидация параметров
- Документация

---

## Как примитив используется в Task

**В Task Orchestrator (state):**

```javascript
SEARCHING: {
  invoke: {
    src: 'primitiveSearchBlock',  // ← Имя service
    input: ({ context }) => ({    // ← Параметры
      blockName: context.taskData.targetBlock,
      maxDistance: 32
    })
  },
  on: {
    FOUND: {                      // ← Событие от примитива
      target: 'NAVIGATING',
      actions: assign({ targetBlock: ({ event }) => event.block })
    }
  }
}
```

---

## Особенности реализации

### Поиск с памятью

`primitiveSearchBlock` должен:

1. Проверить известные локации в `bot.hsm.memory`
2. Если нашёл рядом - использовать память
3. Иначе - искать в мире
4. Запомнить новую находку

### Навигация с AntiStuck

`primitiveNavigating` должен:

1. Установить goal через pathfinder
2. Отслеживать застревание (не двигается)
3. При застревании - попробовать другой путь
4. Слушать события `path_update`, `goal_reached`

### Асинхронные операции

`primitiveBreaking` и `primitivePlacing`:

- Используют `async/await`
- Реализованы в `onStart` (не `onTick`)
- Проверяют `abortSignal` для отмены

---

## Файл реализации

**Файл:** `src/hsm/actors/primitives/primitiveSearchBlock.primitives.ts`

```javascript
export const primitiveSearchBlock = createStatefulService({
	/* ... */
})
```

**Файл:** `src/hsm/actors/primitives/primitiveSearchEntity.primitives.ts`

```javascript
export const primitiveSearchEntity = createStatefulService({
/_ ... _/
})
```

**Файл:** `src/hsm/actors/primitives/primitiveNavigating.primitives.ts`

```javascript
export const primitiveNavigating = createStatefulService({
	/* ... */
})
```

**Файл:** `src/hsm/actors/primitives/primitiveBreaking.primitives.ts`

```javascript
export const primitiveBreaking = createStatefulService({
	/* ... */
})
```

**Файл:** `src/hsm/actors/primitives/index.primitives.js`

```javascript
export default {
	primitiveSearchBlock,
	primitiveSearchEntity,
	primitiveNavigating,
	primitiveBreaking,
	primitivePlacing,
	primitiveOpenContainer
}
```

**Регистрация в actors:**

Файл: `src/hsm/actors/index.actors.js`

```javascript
import primitives from './primitives.actors.js'
import combat from './combat.actors.js'

export const actors = {
	...primitives,
	...combat
}
```

---

## Таблица примитивов (полная)

| Примитив                 | Категория | Sync/Async | Нужна память | События                    |
| ------------------------ | --------- | ---------- | ------------ | -------------------------- |
| `primitiveSearchBlock`   | Поиск     | Sync       | ✅ Да        | FOUND, NOT_FOUND           |
| `primitiveSearchEntity`  | Поиск     | Sync       | ❌ Нет       | FOUND, NOT_FOUND           |
| `primitiveNavigating`    | Навигация | Sync       | ❌ Нет       | ARRIVED, NAVIGATION_FAILED |
| `primitiveBreaking`      | Действие  | Async      | ❌ Нет       | BROKEN, BREAKING_FAILED    |
| `primitivePlacing`       | Действие  | Async      | ❌ Нет       | PLACED, PLACING_FAILED     |
| `primitiveOpenContainer` | Действие  | Async      | ✅ Да        | OPENED, OPENING_FAILED     |
| `primitiveCraft`         | Крафт     | Async      | ❌ Нет       | CRAFTED, CRAFTING_FAILED   |
| `primitiveSmelt`         | Плавка    | Async      | ❌ Нет       | SMELTED, SMELTING_FAILED   |

---

## Расширение системы

Добавление нового примитива:

1. Создать service в `src\hsm\actors\primitives\primitive[Name].primitives.js`
2. Добавить в `PRIMITIVE_REGISTRY`
3. Экспортировать из `src\hsm\actors\primitives\index.primitives.ts`
4. Использовать в Task через `invoke`

**Новые примитивы для будущего:**

- `primitiveEquip` - экипировать предмет
- `primitiveDrop` - выбросить предмет
- `primitiveAttack` - атаковать сущность
- `primitiveEat` - съесть еду
- `primitiveWait` - подождать N секунд
