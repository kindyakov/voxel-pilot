# 1. Executive Summary

Главная проблема не в том, что файлы просто большие. Проблема в неправильном владении ответственностями: контракты, orchestration, provider-specific transport, tool catalog, inline execution, validation и runtime-правила смешаны в трех entry-модулях. Это уже architectural drift, а не вопрос форматирования.

Рекомендуемая стратегия: не делать “большой переписон”, а стабилизировать публичные контракты, превратить `tools.ts`, `loop.ts`, `client.ts` в тонкие фасады и вынести поведение в небольшие модули по ответственности. Первый принцип рефакторинга здесь: сначала отделить контракты и инфраструктуру, потом вытащить pure-правила, и только после этого разрезать orchestration.

Допущение: текущее внешнее поведение, импорт-контракты HSM и существующие тесты для agent loop/window runtime должны сохраняться на всем протяжении миграции.

# 2. Диагностика по файлам

## [src/ai/tools.ts](D:/Developer/Minecraft_bot/src/ai/tools.ts)

Вероятные фактические ответственности модуля:
- декларация словаря tool names и их классификации (`inline/control/execution`)
- хранение system prompt для агента
- хранение OpenAI tool schema catalog
- inline tool execution для memory/inventory/blocks/entities/window
- низкоуровневые преобразования координат/аргументов
- доменные правила window-session reuse и временного inspect/open/close поведения
- summary текста для execution fallback

Признаки drift/god-file:
- 678 строк для файла, который должен быть либо catalog, либо executor dispatcher, но не обоими сразу
- импортирует `runtime/window`, `runtime/inspect`, `core/memory/types`, `vec3`, `Bot`, то есть одновременно знает schema layer и live runtime
- `PendingExecution` живет в `tools.ts`, хотя это не tool catalog concern, а общий execution contract
- `executeInlineToolCall` уже сам по себе самостоятельный service/facade, но спрятан в god-file

Смешение ответственностей:
- `tool registry` и `tool execution`
- schema definitions и runtime interaction
- state/session management для window inspection
- data coercion и business rules
- prompt text и execution summary

Что выносить:
- `PendingExecution` и tool-контракты в отдельный contracts-модуль
- prompt в отдельный `tools/prompt.ts`
- schema catalog в `tools/catalog.ts`
- классификацию имен инструментов в `tools/names.ts`
- memory/inspect/window inline handlers в отдельные executors
- position/vector/shared parsers в `tools/shared.ts` или `contracts/position.ts`

## [src/ai/loop.ts](D:/Developer/Minecraft_bot/src/ai/loop.ts)

Вероятные фактические ответственности модуля:
- orchestration полного agent turn
- snapshot -> model request -> response handling loop
- retry policy и inline rounds policy
- transcript/logging
- grounding rules для world facts
- validation правил для inline/execution tools
- превращение model response в `finish/execute/failed`
- частично policy engine для task relevance

Признаки drift/god-file:
- 892 строки в модуле одного use case
- внутри одного файла сосуществуют pure validation rules, state accumulation, prompt loop, transport invocation и logging side effects
- здесь скрыта значимая бизнес-логика: что считается grounded, когда finish text допустим, какие execution steps релевантны task context
- зависимость на `client.ts`, `tools.ts`, `snapshot.ts`, `taskContext.ts` одновременно делает файл центральным узлом coupling

Смешение ответственностей:
- orchestration
- retries
- loop control
- validation
- error handling
- state/context management
- telemetry/logging
- policy rules
- execution gating
- grounding/reference indexing

Что выносить:
- `AgentTurnInput/Result` в contracts
- `collectGroundedFacts` и связанные индексы в `loop/grounding.ts`
- `validateInlineTool` и `validateExecutionTool` в `loop/validation.ts`
- retry/round constants и terminal-decision rules в `loop/policy.ts`
- transcript/log formatting в `loop/transcript.ts`
- сам `runAgentTurn` оставить как orchestration-only use case

## [src/ai/client.ts](D:/Developer/Minecraft_bot/src/ai/client.ts)

Вероятные фактические ответственности модуля:
- общий контракт model client
- transport adapter для OpenAI Responses API
- transport adapter для OpenAI-compatible chat completions
- parsing/normalization tool calls
- session/history management для chat-compatible клиента
- config-based provider selection

Признаки drift/god-file:
- 413 строк для файла, который должен быть либо contract/factory, либо набор adapter implementations
- generic abstraction и concrete OpenAI SDK detail живут вместе
- provider-specific mapping logic находится рядом с общим интерфейсом
- session state (`history`, `pendingToolCalls`, `activeInstructions`) живет в том же файле, где и factory

Смешение ответственностей:
- transport/client logic
- provider-specific logic
- config resolution
- request/response normalization
- type declarations
- stateful session behavior

Что выносить:
- интерфейсы и DTO в `contracts/agentClient.ts`
- `OpenAIResponsesClient` в `client/responsesClient.ts`
- `OpenAICompatibleChatClient` в `client/chatClient.ts`
- parsers/mappers в `client/parsers.ts`
- `createAgentClient` в `client/factory.ts`

# 3. Ключевые архитектурные проблемы

- Неправильное владение контрактами. `PendingExecution` находится в `tools.ts`, хотя используется HSM и loop как системный execution contract.
- Смешение orchestration и domain rules. `loop.ts` одновременно крутит модельный цикл и принимает продуктовые решения о grounded facts и релевантности шагов.
- Смешение tool catalog и runtime behavior. `tools.ts` содержит и OpenAI schema, и прямое выполнение live-инспекции окна/инвентаря.
- Provider-specific код не изолирован. `client.ts` связывает OpenAI SDK детали с generic client interface.
- Скрытая бизнес-логика размазана по helper-функциям. `isWindowCompatibleMemoryEntry`, `validateExecutionTool`, `collectGroundedFacts` выглядят как утилиты, но фактически задают поведение агента.
- Слишком сильная зависимость `loop.ts` от соседних модулей. Любое изменение tools/client/runtime может затронуть turn orchestration.
- Публичные seams не оформлены как фасады. Тесты и HSM завязаны на файлы, которые одновременно являются и public API, и реализацией.

# 4. Целевая архитектура

Рекомендуемый вариант: гибридная декомпозиция по ответственности, а не “чисто по слоям” и не “по провайдерам целиком”.

Слои:
- `contracts`: общие интерфейсы, DTO и типы поведенческих контрактов без runtime/OpenAI зависимостей.
- `loop`: application/orchestration слой одного use case `runAgentTurn`.
- `tools`: tool vocabulary, schema catalog и inline execution dispatch.
- `client`: инфраструктурные model-client adapters и factory.
- `runtime`: существующий live Minecraft runtime слой, не смешивать с catalog/orchestration.

Допустимые зависимости:
- `loop/* -> contracts/*`
- `loop/* -> client/factory`
- `loop/* -> tools/catalog`, `tools/names`, `tools/prompt`, `tools/inlineExecutor`, `tools/summary`
- `loop/* -> snapshot.ts`, `taskContext.ts`
- `tools/executors/* -> runtime/*`, `core/memory/*`, `types`
- `client/* -> contracts/*`, `config/*`, OpenAI SDK

Запрещенные зависимости:
- `client/* -> loop/*`
- `client/* -> runtime/*`
- `tools/catalog|prompt|names -> runtime/*`
- `tools/executors/* -> loop/*`
- `contracts/* -> client/*`, `loop/*`, `runtime/*`
- `hsm/* -> client/*` или `tools/executors/*`

Где должны быть интерфейсы:
- `contracts/agentClient.ts`: `AgentModelClient`, request/result DTO
- `contracts/agentTurn.ts`: `AgentTurnInput`, `AgentTurnResult`
- `contracts/execution.ts`: `PendingExecution` и, при необходимости, `ExecutionToolName`

Где должны быть конкретные реализации:
- `client/responsesClient.ts`
- `client/chatClient.ts`
- `tools/executors/memory.ts`
- `tools/executors/inspect.ts`
- `tools/executors/window.ts`
- `loop/runAgentTurn.ts`

Краткое сравнение альтернатив:
- Альтернатива “только domain/application/infrastructure” слишком абстрактна для текущего codebase и ухудшит discoverability.
- Альтернатива “файл на каждый tool” на раннем этапе даст фрагментацию без реальной отдачи.
- Рекомендуемый гибридный вариант дает контролируемую миграцию и минимальный риск для импортов.

# 5. Предлагаемая структура файлов

```text
src/ai/
  client.ts
  loop.ts
  tools.ts
  snapshot.ts
  taskContext.ts
  runtime/
    inspect.ts
    window.ts
  contracts/
    agentClient.ts
    agentTurn.ts
    execution.ts
  client/
    factory.ts
    responsesClient.ts
    chatClient.ts
    parsers.ts
  tools/
    prompt.ts
    catalog.ts
    names.ts
    summary.ts
    shared.ts
    inlineExecutor.ts
    executors/
      memory.ts
      inspect.ts
      window.ts
  loop/
    runAgentTurn.ts
    grounding.ts
    validation.ts
    policy.ts
    transcript.ts
```

Назначение директорий и файлов:
- `client.ts`: backward-compatible facade; реэкспорт из `client/*` и `contracts/agentClient.ts`.
- `loop.ts`: backward-compatible facade; наружу только `runAgentTurn` и turn contracts.
- `tools.ts`: backward-compatible facade; наружу только catalog/prompt/names/inline executor/summary.
- `contracts/agentClient.ts`: общий контракт клиента модели, чтобы orchestration не зависел от OpenAI SDK.
- `contracts/agentTurn.ts`: формализует вход/выход use case `runAgentTurn`.
- `contracts/execution.ts`: вынимает `PendingExecution` из неверного owner-модуля.
- `client/factory.ts`: изолирует provider selection и config resolution.
- `client/responsesClient.ts`: отдельный adapter под Responses API.
- `client/chatClient.ts`: отдельный stateful adapter под chat-completions совместимые провайдеры.
- `client/parsers.ts`: парсинг JSON args, tool call normalization, serialize input; это pure testable code.
- `tools/prompt.ts`: system prompt живет отдельно от execution.
- `tools/catalog.ts`: только tool schema definitions.
- `tools/names.ts`: `AgentToolName`, `InlineToolName`, classifier helpers.
- `tools/summary.ts`: `summarizeExecution` как отдельное presentation/policy utility.
- `tools/shared.ts`: position/vector coercion и прочие локальные pure helpers.
- `tools/inlineExecutor.ts`: dispatcher, который маршрутизирует в family executors.
- `tools/executors/memory.ts`: `memory_*` handlers.
- `tools/executors/inspect.ts`: `inspect_inventory`, `inspect_blocks`, `inspect_entities`.
- `tools/executors/window.ts`: `inspect_window` и window-session rules.
- `loop/runAgentTurn.ts`: orchestration use case без скрытых helper-куч.
- `loop/grounding.ts`: структура grounded facts и сбор фактов из inline outputs.
- `loop/validation.ts`: tool relevance и grounding validation.
- `loop/policy.ts`: retry/round/terminal policy.
- `loop/transcript.ts`: transcript/log side helpers.

# 6. План миграции по этапам

## Этап 1. Стабилизация контрактов и фасадов

Цель:
- отделить public API от реализаций, не меняя поведение

Действия:
- создать `contracts/agentClient.ts`, `contracts/agentTurn.ts`, `contracts/execution.ts`
- перенести туда только типы и интерфейсы
- оставить в `tools.ts`, `loop.ts`, `client.ts` реэкспорты старых имен
- обновить внутренние импорты новых модулей на contracts, внешние импорты пока не трогать

Ожидаемый результат:
- типы больше не принадлежат неправильным модулям
- дальнейшие выделения можно делать без каскадного перемещения публичных импортов

Риски:
- сломать type-only импорты в HSM и тестах
- случайно изменить runtime export shape

Проверка:
- `npm run type-check`
- `npm run build`
- тесты `[src/tests/ai/agentLoop.test.ts](D:/Developer/Minecraft_bot/src/tests/ai/agentLoop.test.ts)`, `[src/tests/ai/windowRuntime.test.ts](D:/Developer/Minecraft_bot/src/tests/ai/windowRuntime.test.ts)`, `[src/tests/core/ChatClient.test.ts](D:/Developer/Minecraft_bot/src/tests/core/ChatClient.test.ts)`

## Этап 2. Выделение transport/client слоя

Цель:
- изолировать provider-specific инфраструктуру от orchestration

Действия:
- вынести interfaces/DTO из `client.ts` в contracts
- переместить `OpenAIResponsesClient` в `client/responsesClient.ts`
- переместить `OpenAICompatibleChatClient` в `client/chatClient.ts`
- вынести parsing/mapping helpers в `client/parsers.ts`
- оставить `client/factory.ts` с `createAgentClient`
- `client.ts` сделать фасадом-реэкспортом

Ожидаемый результат:
- `loop` видит только `AgentModelClient`
- весь OpenAI SDK detail локализован в `client/*`

Риски:
- сломать stateful history behavior chat-compatible клиента
- случайно изменить JSON parsing tool calls

Проверка:
- `[src/tests/core/ChatClient.test.ts](D:/Developer/Minecraft_bot/src/tests/core/ChatClient.test.ts)` без изменений
- добавить/удержать unit tests на parsers при реализации
- `agentLoop.test.ts` должен продолжить работать через injected client

## Этап 3. Разделение tool catalog и inline execution

Цель:
- превратить `tools.ts` из god-file в тонкий public entry

Действия:
- вынести tool names/classification в `tools/names.ts`
- вынести prompt в `tools/prompt.ts`
- вынести schema catalog в `tools/catalog.ts`
- вынести `summarizeExecution` в `tools/summary.ts`
- вынести shared position/scope helpers в `tools/shared.ts`
- создать `tools/inlineExecutor.ts` как dispatcher
- разнести inline handlers по `executors/memory.ts`, `executors/inspect.ts`, `executors/window.ts`
- сохранить `executeInlineToolCall` как фасадный экспорт из `tools.ts`

Ожидаемый результат:
- schema layer не знает про runtime/window internals
- window-specific logic изолирована и тестируема отдельно
- `tools.ts` перестает быть местом “всего подряд”

Риски:
- сломать `inspect_window` semantics и reuse/close_failed rules
- потерять строгую классификацию tool names

Проверка:
- `[src/tests/ai/windowRuntime.test.ts](D:/Developer/Minecraft_bot/src/tests/ai/windowRuntime.test.ts)` должен проходить без изменения test semantics
- повторный запуск `[src/tests/ai/agentLoop.test.ts](D:/Developer/Minecraft_bot/src/tests/ai/agentLoop.test.ts)` для проверки, что loop по-прежнему исполняет inline tools через тот же contract

## Этап 4. Выделение pure-правил из loop

Цель:
- убрать из `runAgentTurn` скрытый policy engine

Действия:
- вынести grounded facts model и `collectGroundedFacts` в `loop/grounding.ts`
- вынести `validateInlineTool` и `validateExecutionTool` в `loop/validation.ts`
- вынести round/retry constants и terminal policy в `loop/policy.ts`
- вынести transcript/log helpers в `loop/transcript.ts`
- `runAgentTurn.ts` оставить только orchestrator: build snapshot, call client, dispatch tool decisions, return result

Ожидаемый результат:
- `runAgentTurn` становится читаемым orchestration use case
- validation и grounding можно тестировать независимо от SDK и runtime loop

Риски:
- изменить порядок side effects или условия terminal branches
- сломать plain-text finish fallback после grounded inline round

Проверка:
- полный `[src/tests/ai/agentLoop.test.ts](D:/Developer/Minecraft_bot/src/tests/ai/agentLoop.test.ts)`
- при реализации добавить точечные unit tests на `grounding.ts` и `validation.ts`
- smoke через `npm run type-check` и `npm run build`

## Этап 5. Консолидация импортов и удаление legacy glue

Цель:
- завершить миграцию без двойного владения логикой

Действия:
- перевести внутренние импорты на новые директории
- оставить `client.ts`, `tools.ts`, `loop.ts` как стабильные фасады или убрать их только если вся внешняя поверхность обновлена сознательно
- удалить дублирующиеся helper-реализации и локальные old-style types
- при необходимости обновить HSM на импорт из `contracts/execution.ts`, но только после стабилизации фасадов

Ожидаемый результат:
- больше нет скрытых дублей и “временных” мостов
- структура `src/ai` отражает реальную ответственность модулей

Риски:
- преждевременное удаление фасадов сломает внешний код
- циклы импортов могут появиться при агрессивном “cleanup”

Проверка:
- grep по дубликатам старых helper names
- отсутствие circular imports в `src/ai`
- все текущие тесты и сборка проходят

# 7. Границы ответственности для каждого исходного файла

## tools.ts

### Оставить
- facade exports для `AGENT_TOOLS`, `AGENT_SYSTEM_PROMPT`, `executeInlineToolCall`
- re-export tool name types и classifier helpers для обратной совместимости
- временный re-export `PendingExecution`, пока внешние импорты не переведены

### Вынести
- schema catalog
- system prompt
- tool taxonomy/classification sets
- `summarizeExecution`
- position/vector/scope coercion helpers
- весь `executeInlineToolCall` body
- `memory_*`, `inspect_*`, `inspect_window` конкретные handlers

### Запретить размещать здесь
- provider/client logic
- loop orchestration
- grounded facts validation
- HSM-specific execution interpretation
- любые новые бизнес-правила task relevance

## loop.ts

### Оставить
- facade export `runAgentTurn`
- re-export `AgentTurnInput/Result` для совместимости
- минимальный composition root turn-level use case, если нужен временно

### Вынести
- grounded facts model и collector
- execution/inline validation
- round/retry policy
- transcript/log formatting helpers
- terminal decision helpers
- любые pure parser/normalizer helpers

### Запретить размещать здесь
- OpenAI SDK specifics
- tool schema catalog
- inline runtime execution bodies
- window-specific session logic
- config/provider selection

## client.ts

### Оставить
- facade export `createAgentClient`
- re-export `AgentModelClient` и client classes только ради совместимости
- возможно тонкий factory bridge

### Вынести
- `OpenAIResponsesClient`
- `OpenAICompatibleChatClient`
- JSON/tool-call parsing
- chat history/session state management
- provider-specific payload mapping
- config-based provider factory implementation

### Запретить размещать здесь
- system prompt
- tool schema definitions
- loop retry/finish policy
- task context/business validation
- runtime Minecraft-specific data handling

# 8. Приоритеты

## Critical
- Вынести `PendingExecution`, `AgentTurnInput/Result`, `AgentModelClient` в contracts.
- Сделать `client.ts`, `tools.ts`, `loop.ts` фасадами, а не носителями логики.
- Изолировать provider-specific transport code из `client.ts`.
- Разделить `tools.ts` на catalog/taxonomy и executor families.
- Вынести validation и grounding из `loop.ts`.

## High
- Выделить `tools/executors/window.ts`, потому что там наиболее хрупкая runtime-логика.
- Вынести `client/parsers.ts`, чтобы убить смешение parsing и transport.
- Вынести `loop/policy.ts` и `loop/transcript.ts`, чтобы упростить основной turn runner.

## Medium
- Консолидировать shared helpers в локальные `shared.ts` модули вместо размазанного copy-paste.
- Перевести HSM на импорт execution contract из `contracts/execution.ts`.
- Упорядочить naming exports и убрать дублирующие type aliases.

## Low
- Переименования для красоты.
- Дополнительное дробление schema/catalog на слишком мелкие файлы.
- Миграция `snapshot.ts` и `taskContext.ts`, если они не мешают текущей фазе.

Что даст максимальное уменьшение связности:
- вынос contracts и client adapters
- отделение tool catalog от inline executors

Что даст максимальное уменьшение размера файлов:
- разрезание `loop.ts` на `grounding/validation/policy/transcript`
- вынос window/memory/inspect handlers из `tools.ts`

Что даст наибольший прирост тестируемости:
- `client/parsers.ts`
- `loop/validation.ts`
- `loop/grounding.ts`
- `tools/executors/window.ts`

Что лучше не трогать на раннем этапе:
- `[src/hsm/machine.ts](D:/Developer/Minecraft_bot/src/hsm/machine.ts)` state topology
- `[src/ai/snapshot.ts](D:/Developer/Minecraft_bot/src/ai/snapshot.ts)` snapshot format
- `[src/ai/runtime/window.ts](D:/Developer/Minecraft_bot/src/ai/runtime/window.ts)` низкоуровневую механику окна, кроме случаев явного багфикса

# 9. Риски и меры снижения

- Риск: случайно сломать публичный контракт импортов.
  Мера: сначала фасады и реэкспорты, потом внутренние переносы.

- Риск: циклические зависимости между `loop/*` и `tools/*`.
  Мера: `loop/*` зависит только от `tools` public leaf modules; `tools/executors/*` не импортируют `loop/*`.

- Риск: business rules уедут в безымянные `utils`.
  Мера: `validation.ts`, `grounding.ts`, `window.ts` называть по доменной ответственности, не создавать `helpers.ts` общего назначения.

- Риск: provider-specific code протечет в orchestration.
  Мера: `runAgentTurn` видит только `AgentModelClient`; все payload transforms живут в `client/*`.

- Риск: window/session behavior деградирует после выделения executors.
  Мера: держать `[src/tests/ai/windowRuntime.test.ts](D:/Developer/Minecraft_bot/src/tests/ai/windowRuntime.test.ts)` как regression gate на каждом шаге.

- Риск: логика relevance/grounding поменяется из-за “чистого рефакторинга”.
  Мера: выносить функции без переписывания условий; сначала byte-for-byte behavioral parity, потом уже отдельная оптимизация.

- Риск: слишком ранний переход внешних импортов на новые внутренние пути.
  Мера: новые папки сначала внутренние, старые entry-файлы остаются официальной поверхностью на период миграции.

- Риск: утонуть в “идеальной архитектуре”.
  Мера: не дробить на десятки микрофайлов; каждый новый модуль должен оправдываться отдельным axis of change.

# 10. Definition of Done для plan phase

План-фаза считается завершенной качественно, если все критерии ниже зафиксированы и могут быть превращены в отдельные задачи без дополнительных решений:

- Целевая ownership-модель определена: contracts, loop, tools, client, runtime.
- Для каждого из трех исходных файлов зафиксировано: что остается, что выносится, что запрещено.
- Определена конкретная целевая структура директорий и файлов.
- Определен безопасный порядок миграции с фасадами и regression gates.
- Явно указаны сохраненные публичные контракты: `runAgentTurn`, `executeInlineToolCall`, `createAgentClient`, существующие entry imports.

Целевые размеры файлов:
- `src/ai/tools.ts`, `src/ai/loop.ts`, `src/ai/client.ts` как фасады: до 40-80 строк каждый
- `loop/runAgentTurn.ts`: до 200-250 строк
- `client/responsesClient.ts` и `client/chatClient.ts`: до 180-220 строк каждый
- `tools/executors/window.ts`: до 180-220 строк
- никакой новый модуль не должен превышать ~250 строк без явной причины

Критерии отсутствия cyclic imports:
- 0 циклов внутри `src/ai`
- `contracts/*` не импортирует ничего из `client/*`, `tools/*`, `loop/*`
- `client/*` и `tools/executors/*` не знают о `loop/*`

Критерии тестируемости:
- parsing/validation/grounding модули тестируются без реального Bot/OpenAI SDK
- runtime executors тестируются через stubs, как текущий `windowRuntime.test.ts`
- orchestration тесты остаются на `runAgentTurn`

Критерии читаемости:
- каждый модуль отвечает на один вопрос
- main entrypoint `runAgentTurn` читается сверху вниз без поиска логики по 30 локальным helper-функциям
- tool schema можно понять без чтения runtime logic
- client adapter можно понять без чтения agent loop

Критерии обратной совместимости:
- HSM и существующие тесты могут продолжать импортировать старые entry-файлы во время миграции
- поведение agent loop и window runtime подтверждается существующими regression tests

# 11. Следующий лучший шаг

Начать с выделения `client`-слоя из [src/ai/client.ts](D:/Developer/Minecraft_bot/src/ai/client.ts): сначала `contracts/agentClient.ts`, затем `client/parsers.ts`, `client/responsesClient.ts`, `client/chatClient.ts`, `client/factory.ts`, а `client.ts` оставить фасадом.

Почему именно так:
- это самый чистый и низкорисковый seam
- он сразу отрезает provider-specific инфраструктуру от orchestration
- после этого `loop.ts` можно резать уже против стабильного `AgentModelClient`, а не против конкретного файла-свалки
- это создает правильный шаблон для следующих двух больших разрезов: `tools.ts` и `loop.ts`
