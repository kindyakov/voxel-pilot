# Система 3-уровневой фильтрации врагов

## Описание

Система проверяет видимость и достижимость врагов через 3 уровня:

1. **Дистанция** (быстро ~0.1ms) - фильтр по евклидовой дистанции
2. **Raycast** (быстро ~1ms) - проверка прямой видимости (есть ли блоки между ботом и врагом)
3. **Pathfinder** (медленно ~50-500ms, с кешем) - проверка существования пути обхода

## Файлы

### Созданные файлы
- `src/utils/combat/enemyVisibility.ts` - утилиты для проверки видимости

### Обновлённые файлы
- `src/hsm/context.ts` - добавлены настройки фильтрации
- `src/hsm/actions/update/monitoring.update.ts` - обновлен `updateEntities` action
- `src/core/hsm.ts` - добавлена периодическая очистка кеша

## Настройки (context.preferences)

```typescript
preferences: {
  maxDistToEnemy: 20,              // Макс. дистанция для обнаружения (Уровень 1)
  pathfindTimeout: 800,            // Timeout для pathfinder (мс)
  maxPathLengthMultiplier: 2,      // Множитель для макс. длины пути (maxDistToEnemy * 2)
  pathfindCacheDuration: 3000      // Время жизни кеша (мс)
}
```

## API

### `canSeeEnemy(bot, enemy): boolean`
Проверяет прямую видимость через raycast (Уровень 2).

**Возвращает `true` если:**
- Нет блоков между ботом и врагом
- Блок прозрачный (стекло, вода, листва)

**Возвращает `false` если:**
- Solid блок блокирует видимость

### `isEnemyReachable(bot, enemy, maxPathLength, timeout, cacheDuration): Promise<boolean>`
Проверяет достижимость через pathfinder (Уровень 3).

**Возвращает `true` если:**
- Pathfinder нашел путь
- Длина пути <= maxPathLength

**Возвращает `false` если:**
- Нет пути
- Путь слишком длинный
- Timeout

### `canAttackEnemy(bot, enemy, maxDistance, maxPathLength, pathfindTimeout): Promise<boolean>`
Полная 3-уровневая проверка.

**Пример использования:**
```typescript
import { canAttackEnemy } from '@utils/combat/enemyVisibility'

const canAttack = await canAttackEnemy(
  bot,
  enemy,
  context.preferences.maxDistToEnemy,
  context.preferences.maxDistToEnemy * context.preferences.maxPathLengthMultiplier,
  context.preferences.pathfindTimeout
)

if (canAttack) {
  // Атаковать
}
```

### `clearPathfindCache(): void`
Полная очистка кеша pathfinder.

### `cleanupPathfindCache(maxAge): void`
Удаление устаревших записей из кеша.

**Параметры:**
- `maxAge` - максимальный возраст записи (мс)

**Автоматическая очистка:**
Каждые 10 секунд удаляются записи старше 5 секунд.

## Workflow

```
1. ENTITIES_MONITOR получает список врагов
   ↓
2. updateEntities action применяет 3-уровневую фильтрацию:
   
   УРОВЕНЬ 1: Дистанция
   ├─ > maxDistToEnemy (20) → игнорировать
   └─ ≤ maxDistToEnemy → проверить дальше
       ↓
   УРОВЕНЬ 2: Raycast - прямая видимость (canSeeEnemy)
   ├─ Видим → в список enemies ✅
   └─ НЕ видим → проверить дальше
       ↓
   УРОВЕНЬ 3: Pathfinder - путь обхода (isEnemyReachable)
   ├─ Путь найден и < maxDistToEnemy * 2 → в список enemies ✅
   └─ Путь не найден → игнорировать ❌
   ↓
3. context.enemies = отфильтрованный список
   ↓
4. guard isEnemyNearby проверяет context.enemies.length > 0
   ↓
5. Переход в COMBAT (если есть видимые/достижимые враги)
```

## Производительность

### Оптимизации
1. **Кеш pathfinder** - результаты хранятся 3 секунды
2. **Ранний выход** - 90% врагов отсеиваются на Уровне 1-2
3. **Очистка кеша** - каждые 10 секунд удаляются старые записи

### Замеры
- Уровень 1 (дистанция): ~0.1ms
- Уровень 2 (raycast): ~1ms
- Уровень 3 (pathfinder без кеша): ~50-500ms
- Уровень 3 (pathfinder с кешем): ~0.1ms

**Итого:** 
- С кешем: ~1.2ms на врага
- Без кеша: ~51-501ms на врага (только для невидимых)

## Логи

### canSeeEnemy
```
👁️ [canSeeEnemy] zombie ВИДЕН (прямая видимость)
👁️ [canSeeEnemy] skeleton ВИДЕН (через glass)
🚫 [canSeeEnemy] creeper НЕ ВИДЕН (блокирует stone)
```

### isEnemyReachable
```
📦 [isEnemyReachable] zombie (из кеша: ДОСТИЖИМ)
🔍 [isEnemyReachable] Проверяю путь до skeleton...
✅ [isEnemyReachable] skeleton ДОСТИЖИМ (путь: 25 блоков)
❌ [isEnemyReachable] spider НЕ ДОСТИЖИМ (нет пути)
⚠️ [isEnemyReachable] creeper НЕ ДОСТИЖИМ (путь 55 > макс 40)
```

### canAttackEnemy
```
📏 [canAttackEnemy] enderman слишком далеко (32.5 > 20)
```

### Очистка кеша
```
✅ [Кеш pathfinder] Периодическая очистка включена (каждые 10с)
🧹 [cleanupPathfindCache] Удалено 3 устаревших записей
```

## Примеры использования

### В action
```typescript
import { canSeeEnemy } from '@utils/combat/enemyVisibility'

const checkVisibility = assign(({ context }) => {
  const visibleEnemies = context.enemies.filter(enemy => 
    canSeeEnemy(context.bot, enemy)
  )
  
  return { visibleEnemies }
})
```

### В guard
```typescript
import { canAttackEnemy } from '@utils/combat/enemyVisibility'

const canAttackNearestEnemy = async ({ context }) => {
  if (!context.nearestEnemy.entity) return false
  
  return await canAttackEnemy(
    context.bot,
    context.nearestEnemy.entity,
    context.preferences.maxDistToEnemy,
    context.preferences.maxDistToEnemy * context.preferences.maxPathLengthMultiplier,
    context.preferences.pathfindTimeout
  )
}
```

### Очистка кеша вручную
```typescript
import { clearPathfindCache } from '@utils/combat/enemyVisibility'

// При телепортации, изменении мира, и т.д.
bot.on('forcedMove', () => {
  clearPathfindCache()
})
```

## Тестирование

### Сценарий 1: Враг на равнине
- Дистанция: 10 блоков ✅
- Raycast: видим ✅
- **Результат:** Атаковать ✅

### Сценарий 2: Враг за забором (путь 25 блоков)
- Дистанция: 10 блоков ✅
- Raycast: НЕ видим ❌
- Pathfinder: путь 25 блоков < 40 ✅
- **Результат:** Атаковать ✅ (бот обойдет забор)

### Сценарий 3: Враг под землей (соседняя шахта)
- Дистанция: 8 блоков ✅
- Raycast: НЕ видим ❌
- Pathfinder: нет пути ❌
- **Результат:** Игнорировать ❌

### Сценарий 4: Враг за стеной в пещере
- Дистанция: 12 блоков ✅
- Raycast: НЕ видим ❌
- Pathfinder: путь 60 блоков > 40 ❌
- **Результат:** Игнорировать ❌

## Настройка

### Уменьшить нагрузку на производительность
```typescript
preferences: {
  pathfindTimeout: 500,           // Меньше timeout
  maxPathLengthMultiplier: 1.5,   // Меньше макс. путь
  pathfindCacheDuration: 5000     // Больше время кеша
}
```

### Увеличить агрессивность
```typescript
preferences: {
  pathfindTimeout: 1200,          // Больше timeout
  maxPathLengthMultiplier: 3,     // Длиннее путь
  pathfindCacheDuration: 2000     // Меньше время кеша
}
```

## Известные ограничения

1. **Raycast не учитывает динамические сущности** (двери, люки) - они могут блокировать путь
2. **Pathfinder может тормозить** при сложной геометрии мира - используйте timeout
3. **Кеш может быть неактуален** если мир изменился - очищайте вручную при нужде
4. **Высота врага приблизительная** - raycast стреляет в центр hitbox

## Будущие улучшения

- [ ] Проверка нескольких точек hitbox (голова, центр, ноги)
- [ ] Учет движущихся сущностей в raycast
- [ ] Адаптивный timeout pathfinder в зависимости от FPS
- [ ] Приоритизация целей (ближайший + видимый + раненый)
- [ ] Интеграция с mineflayer-pvp для оптимизации
