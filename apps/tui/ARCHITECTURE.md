# Архитектура TUI

Общие workspace-границы принадлежат [корневой архитектуре](../../ARCHITECTURE.md); порядок работы — [AGENTS.md](AGENTS.md).

```text
src/
├── index.ts                 # Вызванный production launch и process exit
├── app/
│   ├── bootstrap.ts         # Явная общая композиция после TTY preflight
│   ├── application.tsx      # Один runtime/app deadline, сигналы, joined shutdown
│   ├── state.ts             # Кеш состояния завершения и окончательного отказа
│   ├── clock.ts             # App deadline clock, не глобальные таймеры Ink
│   └── App.tsx              # Композиция экрана, границы отказов и постоянный ввод
├── runtime/
│   ├── telemetryStore.ts    # Один bridge публичных snapshot/history references
│   └── useTelemetry.ts      # React external-store binding
├── terminal/
│   ├── preflight.ts         # Интерактивный stdin/stdout и raw capability
│   ├── session.ts           # Native Ink flush/exit, raw/screen/cursor restoration
│   ├── ExitInput.tsx        # q/raw Ctrl+C → app action port на всех экранах
│   └── display.ts           # Безопасный single-line текст и форматирование timestamps
├── features/
│   ├── connection/index.tsx # Публичное подключение и сохраняемый окончательный отказ
│   ├── logs/index.tsx       # Строки INFO+ текущей ограниченной core history
│   └── status/
│       ├── index.tsx        # Показатели, HSM, мониторинг и цель из публичного снимка
│       ├── projection.ts    # Чистая семантика unknown/zero/stale и длительности
│       ├── clock.ts         # Отдельный display-time порт now/schedule
│       └── useStatusNow.ts  # Одна отменяемая привязка времени к React
├── ui/                      # Независимые Header, FailureBoundary и Meter
└── tests/                   # Полный app на native Ink и portable fake runtime
```

## Владельцы

Приложение создаёт один runtime и app-owned logger через реальный `@voxel-pilot/application`. Общий пакет владеет явной загрузкой settings, config/path/output composition для CLI/TUI; его импорт инертен. TTY preflight выполняется до вызова этой композиции. Safe preview инъецирует только публичный BotRuntime и close-порт, обходя production settings/resources.

Core runtime.stop остаётся единственным владельцем отмены, сохранения и native cleanup. Application присоединяет q, raw Ctrl+C, SIGINT/SIGTERM и fatal к одному Promise, затем закрывает собственный logger и терминал в пределах одного дедлайна. Окончательный отказ подключения остаётся данными на экране до явного выхода; ошибка feature изолируется локальной границей, fatal экрана запускает shutdown. Исключения не выводятся как сырые error/stack.

Bridge хранит только текущие неизменяемые ссылки публичных BotSnapshot/LogHistory, подписывается один раз на каждый канал и освобождается владельцем приложения. Исходная история, удержание, секретная проекция и статистика остаются в core. React-компоненты не конструируют runtime и не накапливают историю. Переносимые алгоритмы навигации/фильтра/LIVE/anchor размещай у владельца presentation при их реализации; терминальные строки/ширины и ввод остаются здесь.

Status получает текущий BotSnapshot через App и общий bridge. Локальная [проекция](src/features/status/projection.ts) сохраняет различия unknown/zero, отдельную stale-метку каждого измерения, настоящие maxHealth/координаты, действие и none/active/paused цели. Она использует только contracts; terminal/view нормализует текст перед отрисовкой, а независимый Meter получает обычные view props. Общий presentation для статуса появляется при фактическом переиспользовании другим потребителем.

StatusClock принадлежит feature и проходит через optional app injection; timestamp formatter журнала и app deadline остаются отдельными портами. Одна привязка читает now каждую секунду и отменяется при смене clock/unmount. Длительность выводится из harness.enteredAt, не из числа тиков или snapshot revision: мониторинг, vitals, цель и журнал не сбрасывают её. Для stale HSM показывается время от входа в последнее известное состояние с явной меткой; updatedAt и retry changedAt не подменяют вход. Новая сессия с unknown harness убирает старый таймер. Окончательная адаптивная раскладка остаётся у terminal/view.

Terminal session владеет одним renderer. Exit observation регистрируется до user components/effects; cached waitUntilExit используется после teardown, чтобы Ink не зарегистрировал новый beforeExit-listener. Нормальный результат ждёт flush, unmount/exit и callback записи восстановления. При недоступном output дедлайн освобождает raw input и подписки, запрашивает восстановление экрана и возвращает ошибочный результат; подтверждение записанных пикселей невозможно, пока stream не отвечает. Static diagnostic отправляется после teardown, когда stderr доступен.

Ink получает тот же native input через узкий guard `setRawMode`: его поздний queued teardown не может выбросить исключение вне app owner. Отказ включения запускает fatal, отказ восстановления даёт `terminal-close-failed` и ненулевой результат, даже если сохранение runtime успешно. Фактический raw state при неисправном native stream может остаться прежним; исходные ошибки не печатаются и остальные stream operations сохраняются.

Ввод находится над всеми size/failure branches. Resize меняет только экран; runtime, bridge и исходная история сохраняются. Display neutralizes управляющие байты и переносы строк, сохраняя DTO и ID источника. Clock порты позволяют воспроизводить display/app deadlines без подмены native Ink timers. Development tsconfig поддерживает внутренний alias ядра при загрузке его публичных development exports; исходники TUI используют только публичные workspace imports.

## Направления импортов и новая feature

App собирает runtime, terminal, features и UI. Reusable modules не импортируют app/entrypoint или executable core/application; bridge использует contracts, terminal получает streams/action ports, features получают публичные DTO. Bridge не зависит от display, terminal — от runtime/features, независимый UI — от terminal/runtime/features. Между features обращайся к `index` другого модуля. Эти правила проверяет корневой AST checker, включая type/export/literal dynamic imports.

Новую feature начинай с её публичных данных/actions и публичного `index`, затем добавляй view у feature. Общую композицию подключай в App, bridge/state изменяй у их существующих владельцев. Игровое поведение и raw Mineflayer/XState остаются в core; UI получает read-only contracts. Геометрию помещай в terminal/view, независимый примитив — в ui. Для каждой изменённой границы обновляй checker fixtures вместе с картой.

## Проверки

[application.test.tsx](src/tests/application.test.tsx) проверяет полный app: native ввод/frames, repeated exits, ожидание stop/save, logger, app deadline, поздние исходы, отказ подключения, initial/raw/render failures, resize, feature/fatal и восстановление. [telemetryStore.test.ts](src/tests/telemetryStore.test.ts) проверяет кеш/observer/disposer; [bootstrap.test.ts](src/tests/bootstrap.test.ts) — реальные общие пути, precedence и независимые DEBUG/file/console policies. Root tests защищают browser contracts, import/layer boundaries, безопасные built/development exports, CWD и sequential storage. CLI tests сохраняют его отдельную headless exit policy. Native платформенная визуальная проверка отличается от controlled-stream evidence.

[statusProjection.test.ts](src/tests/statusProjection.test.ts) проверяет чистые преобразования; [status.test.tsx](src/tests/status.test.tsx) — последние реальные кадры default Dashboard на копируемых публичных фактах и отдельном управляемом StatusClock. После clock/resize нужно дождаться запланированного React commit, затем native app.flush; passive cleanup проверяется после effect barrier. Глобальные таймеры Ink остаются настоящими, app deadline clock независим от display-time fixture.
