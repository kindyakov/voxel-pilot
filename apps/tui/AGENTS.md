# Инструкции TUI

Действуют [корневые правила](../../AGENTS.md). Перед изменением TUI прочитай [локальную архитектуру](ARCHITECTURE.md), затем реализацию владельца, вызывающий код и его тесты. Для визуальных изменений открой [dashboard.png](../../.agents/design/tui/dashboard.png) и [пояснения](../../.agents/design/tui/README.md).

Обычная проверка использует полный app с публичным fake runtime и управляемыми потоками. `start`, `dev`, `tui` и `dev:tui` запускают настоящего бота; используй их только для согласованного живого сценария. Безопасный host вызывает `startTuiApplication` с явным `compose`, не production bootstrap.

После изменения выполни корневые gates из AGENTS.md и локальный `pnpm --filter @voxel-pilot/tui test`. Для composition/shutdown проверь CLI и root workspace/import tests: они защищают общие пути, import safety, headless-запуск и development exports. Native Ink проверяй через raw-ввод, resize, write callbacks, render flush и фактическое app completion; callback-spy не доказывает сохранение или восстановление терминала. Инъекция времени относится к app deadline/display; глобальные таймеры Ink остаются настоящими.

Изменяя размещение модулей, синхронно обнови ARCHITECTURE.md и правила/negative fixtures существующего [AST checker](../../scripts/check-imports.mjs). Проверки не запускают Minecraft или модель и не читают локальный `.env`.
