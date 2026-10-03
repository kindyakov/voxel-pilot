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
│   ├── ExitInput.tsx        # Exit и log-navigation action ports на всех экранах
│   ├── layout.ts            # Единый cell/record budget wide/narrow/tiny и страницы
│   ├── capabilities.ts      # Явные TTY/color/locale hints и ASCII-рамка
│   ├── logNavigation.ts     # Структурный action port и общая ёмкость страницы
│   └── display.ts           # Безопасный текст, cell clipping/word wrapping и display clock
├── features/
│   ├── connection/index.tsx # Публичное подключение и сохраняемый окончательный отказ
│   ├── logs/                # Публичный hook/view, local external store переносимой модели
│   └── status/
│       ├── index.tsx        # Показатели, HSM, мониторинг и цель из публичного снимка
│       ├── projection.ts    # Чистая семантика unknown/zero/stale и длительности
│       ├── clock.ts         # Отдельный display-time порт now/schedule
│       └── useStatusNow.ts  # Одна отменяемая привязка времени к React
├── ui/                      # Независимые Header, FailureBoundary, Meter и общая palette
└── tests/                   # Полный app на native Ink и portable fake runtime
```

## Владельцы

Приложение создаёт один runtime и app-owned logger через реальный `@voxel-pilot/application`. Общий пакет владеет явной загрузкой settings, config/path/output composition для CLI/TUI; его импорт инертен. TTY preflight выполняется до вызова этой композиции. Safe preview инъецирует только публичный BotRuntime и close-порт, обходя production settings/resources.

Core runtime.stop остаётся единственным владельцем отмены, сохранения и native cleanup. Application присоединяет q, raw Ctrl+C, SIGINT/SIGTERM и fatal к одному Promise, затем закрывает собственный logger и терминал в пределах одного дедлайна. Окончательный отказ подключения остаётся данными на экране до явного выхода; ошибка feature изолируется локальной границей, fatal экрана запускает shutdown. Исключения не выводятся как сырые error/stack.

Bridge хранит только текущие неизменяемые ссылки публичных BotSnapshot/LogHistory, подписывается один раз на каждый канал и освобождается владельцем приложения. Исходная история, удержание, секретная проекция и статистика остаются в core. React-компоненты не конструируют runtime и не накапливают историю. [useLogView](src/features/logs/useLogView.ts) постоянно смонтирован в App и получает history через локальную подписку bridge; [store](src/features/logs/store.ts) связывает переносимую модель `@voxel-pilot/presentation` с React. Подписка на core остаётся одной. Terminal декодирует d/стрелки/PgUp/PgDn/End через структурный action port; строки/ширины и компактная видимая отметка усечения принадлежат display/view.

В PAUSED модель сохраняет opaque-ID якоря и четыре scalar baseline счётчика; полный новый history заменяет текущую ссылку. Пропущенные revision и уже вытесненные arrivals учитываются через acceptedByLevel. Скрытый DEBUG-якорь отображает предыдущую подходящую запись; вытесненный якорь переходит к первой сохранённой подходящей записи с явной потерей и остаётся PAUSED. Фильтр/resize/arrivals не включают LIVE. End или явная прокрутка к последней подходящей записи сбрасывают pause-local факты; накопительная статистика core остаётся. Другой journalId начинает LIVE, сохраняя DEBUG preference.

Status получает текущий BotSnapshot через App и общий bridge. Локальная [проекция](src/features/status/projection.ts) сохраняет различия unknown/zero, отдельную stale-метку каждого измерения, настоящие maxHealth/координаты, действие и none/active/paused цели. Она использует только contracts; terminal/view нормализует текст перед отрисовкой, а независимый Meter получает обычные view props. Общий presentation для статуса появляется при фактическом переиспользовании другим потребителем.

StatusClock принадлежит feature и проходит через optional app injection; timestamp formatter журнала и app deadline остаются отдельными портами. Одна привязка читает now каждую секунду и отменяется при смене clock/unmount. Длительность выводится из harness.enteredAt, не из числа тиков или snapshot revision: мониторинг, vitals, цель и журнал не сбрасывают её. Для stale HSM показывается время от входа в последнее известное состояние с явной меткой; updatedAt и retry changedAt не подменяют вход. Новая сессия с unknown harness убирает старый таймер.

[layout.ts](src/terminal/layout.ts) рассчитывает единую геометрию из размера TTY и наличия окончательного отказа. App держит единственный useWindowSize; Dashboard и постоянно смонтированный ExitInput получают один budget. Wide размещает журнал/статус примерно 65/35 и резервирует две горизонтальные линии под header/над footer. При обычном running/READY без retry/failure header уже сообщает подключение: две повторяющиеся context rows скрыты, а budget возвращает их журналу. Boot/connect/retry/reconnect/failure/STOPPING сохраняют context и прежнее ожидание persistence. При 24 строках body expanded status разделяет HP/сытость (числа справа, bar отдельной строкой), POS, HSM и цель с промежутками и muted dividers; main path/action/monitors/goal получают по две безопасные cell rows. Недостаточно высокий wide и narrow используют компактный status; narrow — десять однострочных rows над журналом. Заголовки, разделитель, footer и отказ имеют явные резервы; PgUp/PgDn двигается на фактическую ёмкость записей, а не wrapped lines. Tiny оставляет enlargement notice и ввод; при свободных rows STOPPING получает до двух safe cell rows существующего trusted message с save wait/deadline, без parsing или нового clock/state. В 1–2 строках приоритет у выхода. Размонтирование виджетов освобождает их clock, но модель/bridge остаются в App. Возврат читает исходный enteredAt. Features получают content widths без повторного вычитания внешней рамки.

[capabilities.ts](src/terminal/capabilities.ts) принимает явные output/TERM/color/locale hints. Application читает только эти hints после preflight и допускает optional `capabilities` для безопасных hosts/tests. Импорт и reusable terminal не читают окружение. NO_COLOR/FORCE_COLOR=0 отключают styling; TERM=dumb/linux и явно не-UTF8 locale выбирают ASCII decorations. Семантические unknown/stale/goal/level/mode значения остаются текстом. Нормализация controls предшествует cell clipping; source truncation имеет отдельный marker, исходные DTO/ID не меняются. Поддержка raw TTY не определяется ОС.

Независимая [palette](src/ui/palette.ts) задаёт общую тёмную тему, мягкий розовый акцент, зелёные индикаторы, светлый текст и slate-разделители. Все стили отключаются одним color capability. Журнал разделяет bold title и muted filter/mode, резервирует реальные интервалы таблицы и выделяет всю строку выбранного opaque-ID muted background с розовым chevron. Expanded Meter использует 14 ячеек, compact — 10; справа остаётся измеренный максимум. В expanded HSM действие показано первым, затем основной путь, время и отдельный мониторинг; координаты и цель выделены bold. [display](src/terminal/display.ts) переносит безопасный текст по границам слов, длинный token — по ячейкам, последняя строка показывает display shortening. Эти операции не меняют факты или навигационную модель.

Terminal session владеет одним renderer. Exit observation регистрируется до user components/effects; cached waitUntilExit используется после teardown, чтобы Ink не зарегистрировал новый beforeExit-listener. Нормальный результат ждёт flush, unmount/exit и callback записи восстановления. При недоступном output дедлайн освобождает raw input и подписки, запрашивает восстановление экрана и возвращает ошибочный результат; подтверждение записанных пикселей невозможно, пока stream не отвечает. Static diagnostic отправляется после teardown, когда stderr доступен.

Ink получает тот же native input через узкий guard `setRawMode`: его поздний queued teardown не может выбросить исключение вне app owner. Отказ включения запускает fatal, отказ восстановления даёт `terminal-close-failed` и ненулевой результат, даже если сохранение runtime успешно. Фактический raw state при неисправном native stream может остаться прежним; исходные ошибки не печатаются и остальные stream operations сохраняются.

Ввод находится над всеми size/failure branches. Resize меняет только экран; runtime, bridge и исходная история сохраняются. Display neutralizes управляющие байты и переносы строк, сохраняя DTO и ID источника. Clock порты позволяют воспроизводить display/app deadlines без подмены native Ink timers. Development tsconfig поддерживает внутренний alias ядра при загрузке его публичных development exports; исходники TUI используют только публичные workspace imports.

## Направления импортов и новая feature

App собирает runtime, terminal, features и UI. Reusable modules не импортируют app/entrypoint или executable core/application; bridge использует contracts, terminal получает streams/action ports, features получают публичные DTO. Bridge не зависит от display, terminal — от runtime/features, независимый UI — от terminal/runtime/features. Между features обращайся к `index` другого модуля. useWindowSize принадлежит App; терминальная геометрия передаётся обычными props. Эти правила проверяет корневой AST checker, включая type/export/literal dynamic imports и geometry identifier вне app.

Новую feature начинай с её публичных данных/actions и публичного `index`, затем добавляй view у feature. Общую композицию подключай в App, bridge/state изменяй у их существующих владельцев. Игровое поведение и raw Mineflayer/XState остаются в core; UI получает read-only contracts. Геометрию помещай в terminal/view, независимый примитив — в ui. Для каждой изменённой границы обновляй checker fixtures вместе с картой.

## Проверки

[adaptive.test.tsx](src/tests/adaptive.test.tsx) проверяет последний реальный native frame: cell/row limits, две раскладки, tiny/restore, единую ёмкость page keys, сохранение anchor/filter/arrivals/timer и упрощённые capabilities. Fixtures старых Unicode-проверок задают display capabilities явно, сохраняя утверждения независимо от host locale. Визуальную проверку выполняй отдельно на публичном fake compose в Windows Terminal и Linux PTY; live сервер требует согласованного окружения.

[displayStyles.test.ts](src/tests/displayStyles.test.ts) запускает native Ink в отдельном процессе с контролируемыми display hints: проверяет точные RGB-акценты, background каждой ячейки выбранной строки, интервалы таблицы и отсутствие SGR при отключённом color capability. Это stream evidence; принятие внешнего нативного кадра выполняется отдельно.

[logs.test.tsx](src/tests/logs.test.tsx) проверяет модель в полном native app через d/стрелки/PgUp/PgDn/End, matching arrivals, скрытый/вытесненный якорь, resize/tiny/feature failure и joined exit. Переносимые алгоритмы проверяются отдельно через публичный presentation API, терминальное сокращение — здесь.

[application.test.tsx](src/tests/application.test.tsx) проверяет полный app: native ввод/frames, repeated exits, ожидание stop/save, logger, app deadline, поздние исходы, отказ подключения, initial/raw/render failures, resize, feature/fatal и восстановление. [telemetryStore.test.ts](src/tests/telemetryStore.test.ts) проверяет кеш/observer/disposer; [bootstrap.test.ts](src/tests/bootstrap.test.ts) — реальные общие пути, precedence и независимые DEBUG/file/console policies. Root tests защищают browser contracts, import/layer boundaries, безопасные built/development exports, CWD и sequential storage. CLI tests сохраняют его отдельную headless exit policy. Native платформенная визуальная проверка отличается от controlled-stream evidence.

[statusProjection.test.ts](src/tests/statusProjection.test.ts) проверяет чистые преобразования; [status.test.tsx](src/tests/status.test.tsx) — последние реальные кадры default Dashboard на копируемых публичных фактах и отдельном управляемом StatusClock. После clock/resize нужно дождаться запланированного React commit, затем native app.flush; passive cleanup проверяется после effect barrier. Глобальные таймеры Ink остаются настоящими, app deadline clock независим от display-time fixture.
