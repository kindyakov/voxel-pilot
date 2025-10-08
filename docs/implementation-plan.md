# Implementation Plan

Пошаговый план реализации 3-уровневой системы задач.

---

## Общий timeline

```
Этап 1: Helpers          [2 дня]
Этап 2: Primitives       [3 дня]
Этап 3: Memory           [2 дня]
Этап 4: Tasks            [4 дня]
Этап 5: Plan Executor    [3 дня]
Этап 6: Validation       [2 дня]
Этап 7: Testing          [2 дня]
────────────────────────────────
ИТОГО:                   18 дней
```

---

## Этап 1: Helpers & Foundation (2 дня)

### Цель
Создать базовую инфраструктуру для services.

### Задачи

**1.1 Обновить `createStatefulService`**
- Файл: `src/hsm/helpers/createStatefulService.js`
- Добавить поддержку: `onStart`, `onTick`, `onAsyncTick`, `onEvents`, `onCleanup`
- Добавить `getContext()` для получения актуального контекста
- Добавить `abortSignal` для async операций

**1.2 Создать `helpers/index.js`**
- Экспорт всех helper функций

**1.3 Обновить `context.js`**
- Добавить поля:
  - `plan: null` - текущий план
  - `taskData: null` - данные текущей задачи
  - `pausedPlan: null` - прерванный план
  - `savedTaskState: null` - сохранённое состояние задачи

### Критерий готовности
- ✅ `createStatefulService` работает с новым API
- ✅ Можно создать тестовый service и запустить его
- ✅ Context расширен нужными полями

---

## Этап 2: Primitive Services (3 дня)

### Цель
Реализовать атомарные действия.

### Задачи

**2.1 Создать registry**
- Файл: `src/hsm/primitives/registry.js`
- Определить `PRIMITIVE_REGISTRY` с описанием всех примитивов

**2.2 Реализовать Search примитивы (День 1)**
- `primitiveSearchBlock`
  - Поиск блоков
  - События: `FOUND`, `NOT_FOUND`
- `primitiveSearchEntity`
  - Поиск мобов/игроков
  - Фильтры: category, distance
  - События: `FOUND`, `NOT_FOUND`

**2.3 Реализовать Navigation (День 1)**
- `primitiveNavigating`
  - Навигация к Vec3/Entity/Block
  - Обработка событий pathfinder
  - AntiStuck логика
  - События: `ARRIVED`, `NAVIGATION_FAILED`

**2.4 Реализовать Interaction (День 2)**
- `primitiveBreaking`
  - Async копание блока
  - События: `BROKEN`, `BREAKING_FAILED`
- `primitivePlacing`
  - Async установка блока
  - События: `PLACED`, `PLACING_FAILED`
- `primitiveOpenContainer`
  - Async открытие контейнера
  - События: `OPENED`, `OPENING_FAILED`

**2.5 Экспорт и регистрация (День 3)**
- Файл: `src/hsm/actors/primitives.actors.js`
- Экспорт всех примитивов
- Регистрация в `src/hsm/actors/index.actors.js`

### Критерий готовности
- ✅ Все примитивы реализованы
- ✅ Каждый примитив протестирован отдельно
- ✅ Registry заполнен
- ✅ Примитивы зарегистрированы в actors

---

## Этап 3: Memory System (2 дня)

### Цель
Реализовать долговременную память бота.

### Задачи

**3.1 Создать BotMemory класс (День 1)**
- Файл: `src/core/memory.js`
- Методы:
  - `load()` - загрузка из JSON
  - `save()` - сохранение в JSON
  - `createDefaultMemory()` - пустая память
  - `rememberLocation()`
  - `findNearestKnown()`
  - `rememberPlayer()`
  - `rememberTask()`
  - `rememberDeath()`
  - `updateStats()`

**3.2 Интегрировать в HSM (День 2)**
- Файл: `src/core/hsm.js`
- Инициализация памяти при старте
- Копирование данных в context
- Автосохранение каждые 5 минут
- Сохранение при SIGINT
- Привязка к bot: `bot.hsm.memory`

**3.3 Обновить примитивы (День 2)**
- `primitiveSearchBlock` - использовать память
- `primitiveOpenContainer` - запоминать сундуки

### Критерий готовности
- ✅ Память загружается при старте
- ✅ Автосохранение работает
- ✅ API памяти функционирует
- ✅ Примитивы используют память

---

## Этап 4: Task Orchestrators (4 дня)

### Цель
Реализовать Task Orchestrators в HSM.

### Задачи

**4.1 Создать Task Registry (День 1)**
- Файл: `src/hsm/tasks/registry.js`
- Определить `TASK_REGISTRY`
- Для каждой задачи:
  - Описание, параметры
  - `preconditions`
  - `canExecute()` функция
  - `suggestions` для автофикса

**4.2 Реализовать MINING (День 1-2)**
- Файл: `src/hsm/machine.js` → `TASKS.MINING`
- Подсостояния:
  - `CHECKING_PRECONDITIONS`
  - `SEARCHING` (invoke: primitiveSearchBlock)
  - `NAVIGATING` (invoke: primitiveNavigating)
  - `BREAKING` (invoke: primitiveBreaking)
  - `CHECKING_GOAL`
- Entry/Exit actions
- Сохранение прогресса

**4.3 Протестировать MINING (День 2)**
- Запустить задачу напрямую
- Проверить цикл добычи
- Проверить достижение цели

**4.4 Реализовать BUILDING (День 3)**
- Проще чем MINING
- Подсостояния:
  - `NAVIGATING`
  - `PLACING` (цикл)
  - `CHECKING_COMPLETE`

**4.5 Реализовать DEPOSIT_ITEMS (День 4)**
- Подсостояния:
  - `SEARCHING` (сундук)
  - `NAVIGATING`
  - `OPENING`
  - `TRANSFERRING`

### Критерий готовности
- ✅ MINING работает end-to-end
- ✅ BUILDING и DEPOSIT_ITEMS реализованы
- ✅ Registry заполнен
- ✅ Прогресс сохраняется при прерывании

---

## Этап 5: Plan Executor (3 дня)

### Цель
Реализовать управление последовательностью задач.

### Задачи

**5.1 Создать PLAN_EXECUTOR state (День 1)**
- Файл: `src/hsm/machine.js` → `TASKS.PLAN_EXECUTOR`
- Подсостояния:
  - `VALIDATING`
  - `EXECUTING_TASK`
  - `CHECKING_PLAN_STATUS`
  - `PLAN_COMPLETED`
  - `PLAN_FAILED`
- Динамический `invoke` (src = task.type)
- Передача params через `input`

**5.2 Реализовать управление индексом (День 2)**
- Actions:
  - `moveToNextTask` - currentIndex++
  - `savePlanState` - сохранить в pausedPlan
- Guards:
  - Проверка завершения плана

**5.3 Реализовать прерывание (День 2)**
- History state для возврата
- Сохранение `currentIndex` при выходе
- Восстановление с того же места

**5.4 Добавить событие START_PLAN (День 3)**
- В `TASKS.IDLE`
- Принимает план через event
- Переходит в `PLAN_EXECUTOR`

### Критерий готовности
- ✅ План из 2-3 задач выполняется последовательно
- ✅ Прерывание и возврат работает
- ✅ currentIndex отслеживается правильно

---

## Этап 6: Validation System (2 дня)

### Цель
Реализовать трёхуровневую валидацию.

### Задачи

**6.1 Реализовать validatePlan (День 1)**
- Файл: `src/hsm/helpers/validatePlan.js`
- Проверка формата плана
- Проверка task types
- Проверка параметров
- Вызов `canExecute()` для каждой задачи
- Проверка зависимостей между задачами

**6.2 Реализовать fixPlan (День 1)**
- Файл: `src/hsm/helpers/fixPlan.js`
- Вставка suggestions перед проблемными задачами
- Повторная валидация

**6.3 Интегрировать в PLAN_EXECUTOR (День 2)**
- В `VALIDATING` state
- Вызов `validatePlan`
- Переход в `AUTO_FIXING` если невалиден
- Переход в `VALIDATION_FAILED` если не удалось исправить

**6.4 Добавить Runtime Checks в Tasks (День 2)**
- В MINING: `CHECKING_PRECONDITIONS`
- Переходы в `REQUESTING_TOOL` или `REQUESTING_INVENTORY_SPACE`

### Критерий готовности
- ✅ Невалидный план отклоняется
- ✅ Автофикс дополняет план недостающими задачами
- ✅ Runtime checks работают в MINING

---

## Этап 7: Testing & Refinement (2 дня)

### Цель
Тестирование всей системы и исправление багов.

### Задачи

**7.1 Интеграционные тесты (День 1)**
- Тест 1: Простой план (MINING oak_log)
- Тест 2: Сложный план (craft iron_pickaxe)
- Тест 3: Невалидный план → автофикс
- Тест 4: Прерывание COMBAT → возврат к плану
- Тест 5: Прерывание EMERGENCY_HEALING → возврат

**7.2 Баг-фиксы (День 1-2)**
- Логирование проблемных мест
- Исправление найденных багов
- Оптимизация производительности

**7.3 Документация (День 2)**
- README с примерами использования
- Комментарии в коде
- Примеры планов

### Критерий готовности
- ✅ Все тесты проходят
- ✅ Нет критичных багов
- ✅ Документация обновлена

---

## Этап 8: AI Integration (опционально, 3 дня)

### Цель
Интеграция AI агента для создания планов.

### Задачи

**8.1 Создать промпты**
- Файл: `src/ai/prompts/taskPlanner.js`
- Промпт с TASK_REGISTRY
- Примеры планов
- Инструкции для AI

**8.2 Реализовать AI агент**
- Файл: `src/ai/agent.js`
- Функция `createPlan(userInput)`
- Вызов LLM API
- Парсинг JSON ответа

**8.3 Добавить команды**
- Команда `!plan <описание>`
- Парсинг естественного языка
- Отправка плана в PLAN_EXECUTOR

### Критерий готовности
- ✅ AI создаёт валидные планы
- ✅ Команды работают
- ✅ Обработка ошибок AI

---

## Этап 9: Combat Refactoring (2 дня)

### Цель
Применить новую архитектуру к COMBAT.

### Задачи

**9.1 Обновить combat services**
- `serviceMeleeAttack` → использовать `createStatefulService`
- `serviceRangedAttack` → аналогично
- `serviceFleeing` → упростить
- `serviceEmergencyHealing` → использовать новый паттерн

**9.2 Убрать дублирование**
- Удалить reenter из COMBAT
- Убрать `analyzeCombat`
- Упростить переходы

### Критерий готовности
- ✅ COMBAT работает без reenter
- ✅ Нет мусора в логах
- ✅ Меньше переходов состояний

---

## Контрольные точки

### Checkpoint 1 (День 5)
- ✅ Helpers готовы
- ✅ Primitives реализованы
- ✅ Memory работает

### Checkpoint 2 (День 9)
- ✅ MINING работает
- ✅ Task Registry заполнен

### Checkpoint 3 (День 12)
- ✅ Plan Executor работает
- ✅ Можно выполнить план из 3 задач

### Checkpoint 4 (День 14)
- ✅ Validation система работает
- ✅ Автофикс работает

### Final (День 18)
- ✅ Все тесты проходят
- ✅ Система стабильна
- ✅ Документация готова

---

## Приоритеты

**Must Have (критично):**
- Primitives (search, navigate, break)
- MINING task
- Plan Executor
- Базовая валидация

**Should Have (важно):**
- Memory system
- Validation с автофиксом
- BUILDING, DEPOSIT_ITEMS tasks
- Runtime checks

**Nice to Have (желательно):**
- AI integration
- SMELTING, CRAFTING tasks
- Advanced analytics
- Combat refactoring

---

## Риски и митигация

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Примитивы работают нестабильно | Средняя | Высокое | Тщательное тестирование каждого |
| Plan Executor сложен | Высокая | Высокое | Начать с простого (2 задачи) |
| Прерывание не работает | Средняя | Среднее | Тесты на прерывание с 1 дня |
| AI создаёт невалидные планы | Высокая | Низкое | Валидация + автофикс |

---

## Следующие шаги

1. **Утвердить план** - согласовать этапы и сроки
2. **Начать с Этапа 1** - создать базовые helpers
3. **Checkpoint каждые 3-4 дня** - проверка прогресса
4. **Адаптировать план** - если что-то идёт не так
