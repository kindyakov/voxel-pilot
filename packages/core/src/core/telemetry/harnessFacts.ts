import type { HarnessSummary } from '@voxel-pilot/contracts'
import type { StateValue } from 'xstate'

import type { MachineContext } from '@/hsm/context.js'

function paths(value: StateValue | undefined, prefix = ''): string[] {
	if (value === undefined) return []
	if (typeof value === 'string') return [`${prefix}${value}`]
	const entries = Object.entries(value)
	return entries.length
		? entries.flatMap(([key, child]) => paths(child, `${prefix}${key}.`))
		: [prefix.slice(0, -1)]
}

function currentAction(main: string, context: MachineContext): string | null {
	if (main.startsWith('TASKS.EXECUTING.'))
		return context.pendingExecution?.toolName ?? null
	switch (main) {
		case 'COMBAT.MELEE_ATTACKING':
			return 'melee_attack'
		case 'COMBAT.RANGED_SKIRMISHING':
			return 'ranged_skirmish'
		case 'COMBAT.RETREATING.RUNNING':
			return 'tactical_retreat'
		case 'URGENT_NEEDS.EMERGENCY_EATING.RUNNING':
			return 'emergency_eating'
		case 'URGENT_NEEDS.EMERGENCY_HEALING.RUNNING':
			return 'emergency_healing'
		default:
			return null
	}
}

/** One projection per actual HSM; only MAIN_ACTIVITY path changes reset its clock. */
export function createHarnessProjection(): (
	value: StateValue,
	context: MachineContext
) => HarnessSummary {
	let previous: HarnessSummary | null = null
	return (value, context) => {
		const mainActivity = paths(
			typeof value === 'string' ? value : value.MAIN_ACTIVITY
		).join(' | ')
		const monitoring = paths(
			typeof value === 'string' ? undefined : value.MONITORING
		).sort()
		const action = currentAction(mainActivity, context)
		const goal: HarnessSummary['goal'] =
			context.currentGoal !== null
				? Object.freeze({ status: 'active', text: context.currentGoal })
				: context.pausedGoal !== null
					? Object.freeze({ status: 'paused', text: context.pausedGoal })
					: Object.freeze({ status: 'none', text: null })
		if (
			previous &&
			previous.mainActivity === mainActivity &&
			previous.action === action &&
			previous.goal.status === goal.status &&
			previous.goal.text === goal.text &&
			previous.monitoring.length === monitoring.length &&
			previous.monitoring.every((path, i) => path === monitoring[i])
		)
			return previous
		previous = Object.freeze({
			mainActivity,
			enteredAt:
				previous?.mainActivity === mainActivity
					? previous.enteredAt
					: Date.now(),
			action,
			monitoring: Object.freeze(monitoring),
			goal
		})
		return previous
	}
}
