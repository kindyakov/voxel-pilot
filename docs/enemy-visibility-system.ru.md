# Видимость в бою

Языковые версии: [English](enemy-visibility-system.md) | [Русский](enemy-visibility-system.ru.md)

Документ описывает текущие общие хелперы видимости боя в `packages/core/src/utils/combat/enemyVisibility.ts`.

## Функции

- `canSeeEnemy(bot, enemy)`
- `isEnemyReachable(bot, enemy, maxPathLength, timeout, cacheDuration)`
- `canAttackEnemy(bot, enemy, maxDistance, maxPathLength, pathfindTimeout, isActiveTask)`
- `cleanupPathfindCache(maxAge)`

## Поведение

`canSeeEnemy()` делает прямолинейную проверку видимости между глазами бота и целью.
Возвращает `false`, если сплошной блок перекрывает линию.

`isEnemyReachable()` использует `mineflayer-pathfinder` с `canDig = false` и кеширует результат по id сущности.
То есть бот считает достижимыми только цели без разбивания блоков.

`canAttackEnemy()` применяет проверки по порядку:

1. дистанция
2. прямая видимость
3. запасной вариант через достижимость

Если задача уже активна, хелпер пропускает дорогую проверку достижимости.

## Где используется

- `packages/core/src/hsm/guards/combat.guards.ts`
- `packages/core/src/hsm/actors/combat.actors.ts`
- `packages/core/src/hsm/actors/monitoring.actors.ts`
- `packages/core/src/core/hsm.ts`

## Заметки

- Кеш pathfinding намеренно маленький и ограниченный по времени.
- `cleanupPathfindCache()` надо вызывать, когда состояние мира изменилось настолько, что кешированная достижимость уже ненадёжна.
