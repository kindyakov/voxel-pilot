# Память

Языковые версии: [English](memory-guide.md) | [Русский](memory-guide.ru.md)

Бот использует SQLite для долговременной памяти.
Файл базы создаётся по имени бота:

```text
data/bot_memory_<botName>.db
```

`MemoryManager` живёт в `packages/core/src/core/memory/`.

## Что хранит память

- известные локации: home, spawn, сундуки, печи, верстаки, ресурсы
- известные игроки и заметки о взаимодействиях
- история задач и успешность
- смерти и извлечённые уроки
- история голов
- агрегатные счётчики: добытые блоки, пройденная дистанция

## API

Текущий публичный API:

- `load()`
- `save()`
- `close()`
- `saveEntry()`
- `readEntries()`
- `updateEntryData()`
- `deleteEntry()`
- `rememberLocation()`
- `findNearestKnown()`
- `rememberPlayer()`
- `rememberTask()`
- `rememberDeath()`
- `updateStats()`
- `updateDistance()`
- `updatePlaytime()`
- `setCurrentGoal()`
- `completeCurrentGoal()`
- `failCurrentGoal()`
- `getMemory()`
- `getKnownLocations()`
- `getTaskStats()`
- `getStats()`

## Модель хранения

В базе две таблицы:

- `memory_meta`
- `memory_entries`

`saveEntry()` пишет или обновляет записи сразу.
`save()` обновляет метки времени метаданных.

## Типы записей

`MemoryEntryType` сейчас поддерживает:

- `container`
- `location`
- `resource`
- `danger`

`rememberLocation()` маппит высокоуровневые локации в эти типы.
Например:

- `home` и `spawn` становятся `location`
- `chest` становится `container`
- `resource` становится `resource`

## Текущее поведение

- записи дедуплицируются по типу и позиции
- чтения можно фильтровать по тегам и дистанции
- `getMemory()` выводит известные локации из сохранённых записей
- создание схемы происходит в `load()`

## Правило сопровождения

При смене схемы добавляй путь миграции.
Не добавляй ad hoc JSON-файлы и второй механизм персистентности.
