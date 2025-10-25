import type { MachineActionParams } from '@hsm/types'

const entryHealthMonitoring = ({ context, event }: MachineActionParams) => {
	// console.log(`🔍 Мониторинг здоровья: ${context.health.toFixed(0)}/20`)
}

const entryHungerMonitoring = ({ context, event }: MachineActionParams) => {
	// console.log(`🔍 Мониторинг голода: ${context.food}/20`)
}

const entryEntitiesMonitoring = ({ context, event }: MachineActionParams) => {
	// console.log(`🔍 Мониторинг сущностей: ${context.entities.length}`)
	// console.log(`🔍 Мониторинг врагов: ${context.enemies.length}`)
}

const entryChatMonitoring = ({ context, event }: MachineActionParams) => {}

const entryInventoryMonitoring = ({ context, event }: MachineActionParams) => {
	// console.log(
	// 	`🔍 Мониторинг инвентаря: ${context.inventory.length} - использовано слотов`
	// )
}

const entryArmorToolsMonitoring = ({
	context,
	event
}: MachineActionParams) => {}

export default {
	entryHealthMonitoring,
	entryHungerMonitoring,
	entryEntitiesMonitoring,
	entryChatMonitoring,
	entryInventoryMonitoring,
	entryArmorToolsMonitoring
}
