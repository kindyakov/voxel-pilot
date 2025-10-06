const entryHealthMonitoring = ({ context, event }) => {
  // console.log(`🔍 Мониторинг здоровья: ${context.health.toFixed(0)}/20`)
}

const entryHungerMonitoring = ({ context, event }) => {
  // console.log(`🔍 Мониторинг голода: ${context.food}/20`)
}

const entryEntitiesMonitoring = ({ context, event }) => {
  // console.log(`🔍 Мониторинг сущностей: ${context.entities.length}`)
  // console.log(`🔍 Мониторинг врагов: ${context.enemies.length}`)
}

const entryChatMonitoring = ({ context, event }) => { }

const entryInventoryMonitoring = ({ context, event }) => {
  console.log(`🔍 Мониторинг инвентаря: ${context.inventory.length} - использовано слотов`)
}

const entryArmorToolsMonitoring = ({ context, event }) => { }

export default {
  entryHealthMonitoring,
  entryHungerMonitoring,
  entryEntitiesMonitoring,
  entryChatMonitoring,
  entryInventoryMonitoring,
  entryArmorToolsMonitoring
}