```
config/
│   └── .env.example
data/
│   └── bot_memory_bot.json
docs/
│   ├── bot_architecture_plan.md
│   ├── enemy-visibility-system.md
│   ├── implementation-plan.md
│   ├── memory-guide.md
│   ├── primitives-guide.md
│   ├── tasks-guide.md
│   ├── testing-enemy-visibility.md
│   └── validation-guide.md
logs/
│   ├── bot.log
│   └── error.log
src/
│   ├── ai/
│   ├── config/
│   │   ├── config.ts
│   │   └── logger.ts
│   ├── core/
│   │   ├── bot.ts
│   │   ├── commandHandler.ts
│   │   ├── hsm.ts
│   │   └── memory.ts
│   ├── hsm/
│   │   ├── actions/
│   │   │   ├── always/
│   │   │   │   ├── combat.always.ts
│   │   │   │   ├── index.always.ts
│   │   │   │   └── monitoring.always.ts
│   │   │   ├── entry/
│   │   │   │   ├── combat.entry.ts
│   │   │   │   ├── index.entry.ts
│   │   │   │   ├── mining.entry.ts
│   │   │   │   ├── monitoring.entry.ts
│   │   │   │   ├── tasks.entry.ts
│   │   │   │   └── urgentNeeds.entry.ts
│   │   │   ├── exit/
│   │   │   │   ├── combat.exit.ts
│   │   │   │   ├── index.exit.ts
│   │   │   │   ├── mining.exit.ts
│   │   │   │   ├── tasks.exit.ts
│   │   │   │   └── urgentNeeds.exit.ts
│   │   │   ├── save/
│   │   │   │   ├── index.save.ts
│   │   │   │   └── pefceful.save.ts
│   │   │   ├── update/
│   │   │   │   ├── combat.update.ts
│   │   │   │   ├── index.update.ts
│   │   │   │   ├── monitoring.update.ts
│   │   │   │   └── root.update.ts
│   │   │   └── index.actions.ts
│   │   ├── actors/
│   │   │   ├── primitives/
│   │   │   │   ├── index.primitive.ts
│   │   │   │   ├── primitiveBreaking.primitive.ts
│   │   │   │   ├── primitiveNavigating.primitive.ts
│   │   │   │   ├── primitiveSearchBlock.primitive.ts
│   │   │   │   └── primitiveSearchEntity.primitive.ts
│   │   │   ├── combat.actors.ts
│   │   │   ├── index.actors.ts
│   │   │   ├── monitoring.actors.ts
│   │   │   └── urgentNeeds.actors.ts
│   │   ├── config/
│   │   │   └── priorities.ts
│   │   ├── guards/
│   │   │   ├── combat.guards.ts
│   │   │   ├── index.guards.ts
│   │   │   ├── mining.guards.ts
│   │   │   ├── monitoring.guards.ts
│   │   │   └── urgentNeeds.guards.ts
│   │   ├── helpers/
│   │   │   ├── createStatefulService.ts
│   │   │   └── index.helpers.ts
│   │   ├── primitives/
│   │   │   └── registry.primitives.ts
│   │   ├── tasks/
│   │   │   ├── index.ts
│   │   │   ├── registry.tasks.ts
│   │   │   └── types.ts
│   │   ├── utils/
│   │   │   ├── antiLoop.ts
│   │   │   ├── blockAnalysis.utils.ts
│   │   │   ├── findNearbyEnemies.ts
│   │   │   ├── getPriority.ts
│   │   │   ├── index.ts
│   │   │   └── isEntityOfType.ts
│   │   ├── context.ts
│   │   ├── machine.ts
│   │   └── types.ts
│   ├── modules/
│   │   ├── connection/
│   │   │   └── index.ts
│   │   └── plugins/
│   │       ├── armorManager.ts
│   │       ├── autoEat.ts
│   │       ├── goals.ts
│   │       ├── hawkeye.ts
│   │       ├── index.plugins.ts
│   │       ├── movement.ts
│   │       ├── pathfinder.ts
│   │       ├── pvp.ts
│   │       ├── tool.ts
│   │       ├── viewer.ts
│   │       └── webInventory.ts
│   ├── scheduler/
│   │   ├── index.ts
│   │   ├── priorities.ts
│   │   └── tasks/
│   ├── tests/
│   ├── types/
│   │   ├── external/
│   │   │   └── mineflayer-web-inventory.d.ts
│   │   └── index.ts
│   └── utils/
│   │   ├── combat/
│   │   │   ├── enemyVisibility.ts
│   │   │   └── index.ts
│   │   ├── general/
│   │   │   ├── generateId.ts
│   │   │   ├── index.general.utils.ts
│   │   │   └── sleep.ts
│   │   └── minecraft/
│   │       ├── AntiStuck.js
│   │       └── botUtils.ts
│   └── index.ts
│-- package.json
│-- package-lock.json
│-- tsconfig.json
│-- .env
│-- .gitignore
│-- .prettierrc
```
