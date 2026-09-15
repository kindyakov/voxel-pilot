import { machine } from '@/hsm/machine.js'

type StateKind = 'compound' | 'leaf' | 'history' | 'parallel'

type StateLayout = {
	path: string
	x: number
	y: number
	width: number
	height: number
	kind: StateKind
	summary: string
}

type EdgeLayout = {
	id: string
	source: string
	target: string
	label: string
	animated?: boolean
	dashed?: boolean
	strokeColor?: string
	entryX?: number
	entryY?: number
	exitX?: number
	exitY?: number
}

type NoteLayout = {
	id: string
	x: number
	y: number
	width: number
	height: number
	title: string
	body: string
	fillColor?: string
	strokeColor?: string
}

export type HsmDrawioDiagram = {
	xml: string
	statePaths: string[]
	animatedEdgeIds: string[]
}

const outputStateLayouts: StateLayout[] = [
	{
		path: 'MAIN_ACTIVITY.OBSERVATION_WAIT',
		x: 90,
		y: 305,
		width: 250,
		height: 100,
		kind: 'leaf',
		summary: 'Execution canceled until valid observations return; no flight.'
	},
	{
		path: 'MAIN_ACTIVITY.COMBAT.WAITING',
		x: 1100,
		y: 210,
		width: 220,
		height: 85,
		kind: 'leaf',
		summary:
			'Controller stopped. Resume on a usable target or bounded changed-condition retry.'
	},
	{
		path: 'MAIN_ACTIVITY.COMBAT.RETREATING',
		x: 1345,
		y: 200,
		width: 285,
		height: 270,
		kind: 'compound',
		summary:
			'Creeper danger only; finish when no dangerous creeper remains nearby.'
	},
	{
		path: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_EATING.RUNNING',
		x: 490,
		y: 270,
		width: 120,
		height: 45,
		kind: 'leaf',
		summary: 'Eat when safe; otherwise defer'
	},
	{
		path: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_EATING.RETRYING',
		x: 625,
		y: 270,
		width: 120,
		height: 45,
		kind: 'leaf',
		summary: 'Retry delay'
	},
	{
		path: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_HEALING.RUNNING',
		x: 490,
		y: 415,
		width: 120,
		height: 45,
		kind: 'leaf',
		summary: 'Observe / flee / eat'
	},
	{
		path: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_HEALING.RETRYING',
		x: 625,
		y: 415,
		width: 120,
		height: 45,
		kind: 'leaf',
		summary: 'Retry delay'
	},
	{
		path: 'MAIN_ACTIVITY.COMBAT.RETREATING.RUNNING',
		x: 1360,
		y: 340,
		width: 115,
		height: 75,
		kind: 'leaf',
		summary: 'Observe / flee'
	},
	{
		path: 'MAIN_ACTIVITY.COMBAT.RETREATING.RETRYING',
		x: 1490,
		y: 340,
		width: 115,
		height: 75,
		kind: 'leaf',
		summary: 'Retry delay'
	},
	{
		path: 'MAIN_ACTIVITY',
		x: 40,
		y: 70,
		width: 1710,
		height: 1260,
		kind: 'compound',
		summary:
			'Main runtime lane. Owns the active behavior: idle, urgent survival, combat, and AI-driven tasks.'
	},
	{
		path: 'MAIN_ACTIVITY.IDLE',
		x: 90,
		y: 145,
		width: 250,
		height: 100,
		kind: 'leaf',
		summary:
			'Resting state. Watches nearby peaceful entities while alive; yields gaze to tasks, combat and survival.'
	},
	{
		path: 'MAIN_ACTIVITY.RESUMING',
		x: 355,
		y: 185,
		width: 70,
		height: 70,
		kind: 'leaf',
		summary: 'Replan the current goal or return to idle after recovery.'
	},
	{
		path: 'MAIN_ACTIVITY.URGENT_NEEDS',
		x: 455,
		y: 125,
		width: 330,
		height: 360,
		kind: 'compound',
		summary:
			'High-priority interrupt lane. Preempts other work when hunger or health crosses emergency thresholds.'
	},
	{
		path: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_EATING',
		x: 475,
		y: 200,
		width: 290,
		height: 130,
		kind: 'compound',
		summary: 'Critical hunger recovery; safe no-food may resume.'
	},
	{
		path: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_HEALING',
		x: 475,
		y: 345,
		width: 290,
		height: 130,
		kind: 'compound',
		summary: 'Continuous survival until healthy AND safe.'
	},
	{
		path: 'MAIN_ACTIVITY.COMBAT',
		x: 830,
		y: 125,
		width: 820,
		height: 370,
		kind: 'compound',
		summary:
			'Self-defense only. Melee, ranged or safe retreat; critical health preempts all modes.'
	},
	{
		path: 'MAIN_ACTIVITY.COMBAT.DECIDING',
		x: 875,
		y: 210,
		width: 160,
		height: 85,
		kind: 'leaf',
		summary: 'Re-evaluates the best combat mode.'
	},
	{
		path: 'MAIN_ACTIVITY.COMBAT.MELEE_ATTACKING',
		x: 900,
		y: 345,
		width: 180,
		height: 95,
		kind: 'leaf',
		summary: 'Owns PvP movement and close-range attack pressure.'
	},
	{
		path: 'MAIN_ACTIVITY.COMBAT.RANGED_SKIRMISHING',
		x: 1110,
		y: 345,
		width: 180,
		height: 95,
		kind: 'leaf',
		summary: 'Owns ranged attacks while visibility and ammo allow it.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS',
		x: 80,
		y: 515,
		width: 1600,
		height: 765,
		kind: 'compound',
		summary:
			'Agent loop. Converts a user goal into one tool decision at a time, executes it, records the result, and repeats.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.IDLE',
		x: 125,
		y: 600,
		width: 210,
		height: 85,
		kind: 'leaf',
		summary: 'Task subsystem is armed but has no active goal yet.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.THINKING',
		x: 400,
		y: 590,
		width: 240,
		height: 105,
		kind: 'leaf',
		summary:
			'Invokes the agent turn and chooses the next execution step or finish.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING',
		x: 715,
		y: 575,
		width: 920,
		height: 630,
		kind: 'compound',
		summary:
			'Execution dispatcher. Routes pending tool work into primitive actors or the mining subworkflow.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.RESOLVE',
		x: 760,
		y: 650,
		width: 180,
		height: 85,
		kind: 'leaf',
		summary: 'Chooses which executor branch handles the pending tool.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING',
		x: 970,
		y: 635,
		width: 620,
		height: 300,
		kind: 'compound',
		summary:
			'Specialized mining workflow with search, travel, break retries, completion tracking, and failure exits.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.CHECKING_PRECONDITIONS',
		x: 1010,
		y: 710,
		width: 145,
		height: 70,
		kind: 'leaf',
		summary: 'Validates the mining request before spending work.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.SEARCHING',
		x: 1190,
		y: 710,
		width: 125,
		height: 70,
		kind: 'leaf',
		summary: 'Invokes block search for matching ore targets.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.CHECKING_DISTANCE',
		x: 1340,
		y: 710,
		width: 145,
		height: 70,
		kind: 'leaf',
		summary: 'Decides whether to break now or navigate first.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.NAVIGATING',
		x: 1095,
		y: 820,
		width: 140,
		height: 70,
		kind: 'leaf',
		summary: 'Moves to the next ore candidate.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.BREAKING',
		x: 1270,
		y: 820,
		width: 125,
		height: 70,
		kind: 'leaf',
		summary: 'Breaks the selected block and counts collection.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.CHECKING_GOAL',
		x: 1430,
		y: 820,
		width: 135,
		height: 70,
		kind: 'leaf',
		summary: 'Checks goal completion, inventory pressure, and next target.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.TASK_COMPLETED',
		x: 1165,
		y: 910,
		width: 155,
		height: 70,
		kind: 'leaf',
		summary: 'Records mining success and returns to decide-next.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.TASK_FAILED',
		x: 1350,
		y: 910,
		width: 135,
		height: 70,
		kind: 'leaf',
		summary: 'Records mining failure and returns to decide-next.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.NAVIGATING',
		x: 760,
		y: 980,
		width: 170,
		height: 80,
		kind: 'leaf',
		summary: 'Primitive navigate_to execution.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.BREAKING',
		x: 960,
		y: 980,
		width: 170,
		height: 80,
		kind: 'leaf',
		summary: 'Primitive break_block execution.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.OPEN_WINDOW',
		x: 1160,
		y: 980,
		width: 170,
		height: 80,
		kind: 'leaf',
		summary: 'Primitive open_window execution with session capture.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.TRANSFER_ITEM',
		x: 1360,
		y: 980,
		width: 170,
		height: 80,
		kind: 'leaf',
		summary: 'Primitive transfer_item execution.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.CLOSE_WINDOW',
		x: 860,
		y: 1090,
		width: 170,
		height: 80,
		kind: 'leaf',
		summary: 'Primitive close_window execution with close-failure tracking.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.PLACING',
		x: 1060,
		y: 1090,
		width: 170,
		height: 80,
		kind: 'leaf',
		summary: 'Primitive place_block execution.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.EXECUTING.FOLLOWING',
		x: 1260,
		y: 1090,
		width: 170,
		height: 80,
		kind: 'leaf',
		summary: 'Primitive follow_entity execution.'
	},
	{
		path: 'MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
		x: 1450,
		y: 1085,
		width: 145,
		height: 85,
		kind: 'leaf',
		summary: 'Loops back to THINKING or aborts to IDLE on anti-loop protection.'
	},
	{
		path: 'MONITORING',
		x: 1785,
		y: 70,
		width: 560,
		height: 455,
		kind: 'parallel',
		summary:
			'Parallel monitors. Continuously watch health, hunger, and entity streams while MAIN_ACTIVITY runs.'
	},
	{
		path: 'MONITORING.HEALTH_MONITOR',
		x: 1845,
		y: 190,
		width: 200,
		height: 95,
		kind: 'leaf',
		summary: 'Routes low-health updates into urgent healing.'
	},
	{
		path: 'MONITORING.HUNGER_MONITOR',
		x: 2080,
		y: 190,
		width: 200,
		height: 95,
		kind: 'leaf',
		summary: 'Routes low-food updates into urgent eating.'
	},
	{
		path: 'MONITORING.ENTITIES_MONITOR',
		x: 1820,
		y: 315,
		width: 490,
		height: 180,
		kind: 'compound',
		summary:
			'Owns observation failures and bounded restart; failure never proves safety.'
	},
	{
		path: 'MONITORING.ENTITIES_MONITOR.RUNNING',
		x: 1850,
		y: 375,
		width: 190,
		height: 85,
		kind: 'leaf',
		summary: 'Invokes tracking and publishes current facts and targets.'
	},
	{
		path: 'MONITORING.ENTITIES_MONITOR.RETRYING',
		x: 2100,
		y: 375,
		width: 190,
		height: 85,
		kind: 'leaf',
		summary: 'Invalidates freshness; waits for recoveryRetry before restarting.'
	}
]

const noteLayouts: NoteLayout[] = [
	{
		id: 'note-root-entry',
		x: 40,
		y: 10,
		width: 900,
		height: 45,
		title: 'MINECRAFT_BOT',
		body: 'Parallel XState root. MAIN_ACTIVITY owns current behavior; MONITORING keeps health, hunger, and entities hot.'
	},
	{
		id: 'note-external-triggers',
		x: 1785,
		y: 545,
		width: 560,
		height: 180,
		title: 'External triggers',
		body: 'USER_COMMAND -> THINKING (deferred during safety)\nSTART_COMBAT -> COMBAT (self-defense only)\nSTOP_COMBAT cannot release safety\nDEATH -> IDLE\nSTOP_CURRENT_GOAL cancels only the goal during safety\nSTART_URGENT_NEEDS -> EMERGENCY_EATING or EMERGENCY_HEALING',
		fillColor: '#f8fafc',
		strokeColor: '#475569'
	},
	{
		id: 'note-agent-loop',
		x: 1785,
		y: 745,
		width: 560,
		height: 130,
		title: 'Agent loop',
		body: 'THINKING invokes one agent turn, EXECUTING runs exactly one pending tool, DECIDE_NEXT loops until finish or anti-loop abort.',
		fillColor: '#ecfeff',
		strokeColor: '#0f766e'
	},
	{
		id: 'note-mining',
		x: 1785,
		y: 895,
		width: 560,
		height: 150,
		title: 'Mining workflow',
		body: 'mine_resource is the only deep execution subtree. It validates preconditions, searches blocks, navigates, breaks, retries, and records completion or failure.',
		fillColor: '#eff6ff',
		strokeColor: '#1d4ed8'
	},
	{
		id: 'note-combat-services',
		x: 1785,
		y: 1065,
		width: 560,
		height: 120,
		title: 'Invoked actors',
		body: 'COMBAT: melee, ranged, tacticalRetreat\nURGENT_NEEDS: emergencyEating / emergencyHealing\nMONITORING: serviceEntitiesTracking',
		fillColor: '#fff7ed',
		strokeColor: '#c2410c'
	},
	{
		id: 'note-legend',
		x: 1785,
		y: 1205,
		width: 560,
		height: 120,
		title: 'Legend',
		body: 'Solid arrows = normal transitions\nAnimated arrows = hot loops worth watching\nDashed arrows = cross-lane or external triggers\nState captions summarize purpose, not raw action lists',
		fillColor: '#ffffff',
		strokeColor: '#111827'
	}
]

const edgeLayouts: EdgeLayout[] = [
	{
		id: 'edge-observer-failed',
		source: 'MONITORING.ENTITIES_MONITOR.RUNNING',
		target: 'MONITORING.ENTITIES_MONITOR.RETRYING',
		label: 'THREAT_OBSERVATION_FAILED'
	},
	{
		id: 'edge-observer-retry',
		source: 'MONITORING.ENTITIES_MONITOR.RETRYING',
		target: 'MONITORING.ENTITIES_MONITOR.RUNNING',
		label: 'after recoveryRetry',
		dashed: true
	},
	{
		id: 'edge-safety-error-0',
		source: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_EATING.RUNNING',
		target: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_EATING.RETRYING',
		label: 'ERROR / failed attempt'
	},
	{
		id: 'edge-safety-retry-0',
		source: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_EATING.RETRYING',
		target: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_EATING.RUNNING',
		label: 'after recoveryRetry',
		dashed: true
	},
	{
		id: 'edge-safety-error-1',
		source: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_HEALING.RUNNING',
		target: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_HEALING.RETRYING',
		label: 'ERROR / failed attempt'
	},
	{
		id: 'edge-safety-retry-1',
		source: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_HEALING.RETRYING',
		target: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_HEALING.RUNNING',
		label: 'after recoveryRetry',
		dashed: true
	},
	{
		id: 'edge-safety-error-2',
		source: 'MAIN_ACTIVITY.COMBAT.RETREATING.RUNNING',
		target: 'MAIN_ACTIVITY.COMBAT.RETREATING.RETRYING',
		label: 'ERROR / failed attempt'
	},
	{
		id: 'edge-safety-retry-2',
		source: 'MAIN_ACTIVITY.COMBAT.RETREATING.RETRYING',
		target: 'MAIN_ACTIVITY.COMBAT.RETREATING.RUNNING',
		label: 'after recoveryRetry',
		dashed: true
	},
	{
		id: 'edge-combat-retreat',
		source: 'MAIN_ACTIVITY.COMBAT',
		target: 'MAIN_ACTIVITY.COMBAT.RETREATING',
		label: 'nearby dangerous creeper'
	},
	{
		id: 'edge-combat-resume-approach',
		source: 'MAIN_ACTIVITY.COMBAT.WAITING',
		target: 'MAIN_ACTIVITY.COMBAT.DECIDING',
		label: 'changed conditions [bounded retry]'
	},
	{
		id: 'edge-combat-wait',
		source: 'MAIN_ACTIVITY.COMBAT',
		target: 'MAIN_ACTIVITY.COMBAT.WAITING',
		label: 'blocked approach / attack unavailable'
	},
	{
		id: 'edge-observation-wait',
		source: 'MAIN_ACTIVITY',
		target: 'MAIN_ACTIVITY.OBSERVATION_WAIT',
		label: 'invalid observation [outside health recovery]'
	},
	{
		id: 'edge-observation-restored',
		source: 'MAIN_ACTIVITY.OBSERVATION_WAIT',
		target: 'MAIN_ACTIVITY.RESUMING',
		label: 'fresh valid observation'
	},
	{
		id: 'edge-root-user-command',
		source: 'note-external-triggers',
		target: 'MAIN_ACTIVITY.TASKS.THINKING',
		label: 'USER_COMMAND',
		dashed: true,
		strokeColor: '#0f766e'
	},
	{
		id: 'edge-root-start-combat',
		source: 'note-external-triggers',
		target: 'MAIN_ACTIVITY.COMBAT',
		label: 'START_COMBAT',
		dashed: true,
		strokeColor: '#b91c1c'
	},
	{
		id: 'edge-root-stop-or-death',
		source: 'note-external-triggers',
		target: 'MAIN_ACTIVITY.IDLE',
		label: 'DEATH / STOP_CURRENT_GOAL',
		dashed: true,
		strokeColor: '#334155'
	},
	{
		id: 'edge-root-start-urgent',
		source: 'note-external-triggers',
		target: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_EATING',
		label: 'START_URGENT_NEEDS',
		dashed: true,
		strokeColor: '#d97706'
	},
	{
		id: 'edge-monitor-health',
		source: 'MAIN_ACTIVITY',
		target: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_HEALING',
		label: 'UPDATE_HEALTH [critical]',
		dashed: true,
		strokeColor: '#dc2626'
	},
	{
		id: 'edge-monitor-hunger',
		source: 'MAIN_ACTIVITY',
		target: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_EATING',
		label: 'UPDATE_FOOD [critical]',
		dashed: true,
		strokeColor: '#d97706'
	},
	{
		id: 'edge-idle-combat',
		source: 'MAIN_ACTIVITY.IDLE',
		target: 'MAIN_ACTIVITY.COMBAT',
		label: 'UPDATE_COMBAT_TARGET [autoDefend]',
		strokeColor: '#b91c1c'
	},
	{
		id: 'edge-urgent-eating-resuming',
		source: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_EATING',
		target: 'MAIN_ACTIVITY.RESUMING',
		label: 'FOOD_RESTORED / no_food [safe]',
		strokeColor: '#d97706'
	},
	{
		id: 'edge-urgent-healing-resuming',
		source: 'MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_HEALING',
		target: 'MAIN_ACTIVITY.RESUMING',
		label: 'HEALTH_RESTORED [healthy AND safe]',
		strokeColor: '#dc2626'
	},
	{
		id: 'edge-combat-retreat-safe',
		source: 'MAIN_ACTIVITY.COMBAT.RETREATING',
		target: 'MAIN_ACTIVITY.COMBAT.DECIDING',
		label: 'RETREAT_SAFE [fresh observation / no dangerous creeper]',
		strokeColor: '#64748b'
	},
	{
		id: 'edge-resuming-task',
		source: 'MAIN_ACTIVITY.RESUMING',
		target: 'MAIN_ACTIVITY.TASKS.THINKING',
		label: 'always [current goal] / replan'
	},
	{
		id: 'edge-resuming-idle',
		source: 'MAIN_ACTIVITY.RESUMING',
		target: 'MAIN_ACTIVITY.IDLE',
		label: 'always [no goal]'
	},
	{
		id: 'edge-combat-deciding-melee',
		source: 'MAIN_ACTIVITY.COMBAT.DECIDING',
		target: 'MAIN_ACTIVITY.COMBAT.MELEE_ATTACKING',
		label: 'always [usable melee weapon / permitted approach]',
		animated: true,
		strokeColor: '#dc2626'
	},
	{
		id: 'edge-combat-deciding-ranged',
		source: 'MAIN_ACTIVITY.COMBAT.DECIDING',
		target: 'MAIN_ACTIVITY.COMBAT.RANGED_SKIRMISHING',
		label: 'always [canSkirmishRanged]',
		animated: true,
		strokeColor: '#ea580c'
	},
	{
		id: 'edge-combat-melee-ranged',
		source: 'MAIN_ACTIVITY.COMBAT.MELEE_ATTACKING',
		target: 'MAIN_ACTIVITY.COMBAT.RANGED_SKIRMISHING',
		label: 'UPDATE_COMBAT_TARGET [ranged from melee]',
		strokeColor: '#ea580c'
	},
	{
		id: 'edge-combat-ranged-melee',
		source: 'MAIN_ACTIVITY.COMBAT.RANGED_SKIRMISHING',
		target: 'MAIN_ACTIVITY.COMBAT.MELEE_ATTACKING',
		label: 'UPDATE_COMBAT_TARGET [enemy closes / ranged unavailable]',
		strokeColor: '#dc2626'
	},
	{
		id: 'edge-combat-no-enemies-thinking',
		source: 'MAIN_ACTIVITY.COMBAT',
		target: 'MAIN_ACTIVITY.TASKS.THINKING',
		label: 'NO_ENEMIES [hasCurrentGoal]',
		dashed: true,
		strokeColor: '#0f766e'
	},
	{
		id: 'edge-combat-no-enemies-idle',
		source: 'MAIN_ACTIVITY.COMBAT',
		target: 'MAIN_ACTIVITY.IDLE',
		label: 'NO_ENEMIES',
		dashed: true,
		strokeColor: '#475569'
	},
	{
		id: 'edge-tasks-entity-combat',
		source: 'MAIN_ACTIVITY.TASKS',
		target: 'MAIN_ACTIVITY.COMBAT',
		label: 'UPDATE_COMBAT_TARGET [auto-enter combat]',
		dashed: true,
		strokeColor: '#b91c1c'
	},
	{
		id: 'edge-agent-loop-thinking-executing',
		source: 'MAIN_ACTIVITY.TASKS.THINKING',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING',
		label: 'onDone [execute]',
		animated: true,
		strokeColor: '#0f766e'
	},
	{
		id: 'edge-thinking-decide-next',
		source: 'MAIN_ACTIVITY.TASKS.THINKING',
		target: 'MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
		label: 'onDone [rejected] / always [budget exhausted]',
		strokeColor: '#d97706'
	},
	{
		id: 'edge-thinking-finish-idle',
		source: 'MAIN_ACTIVITY.TASKS.THINKING',
		target: 'MAIN_ACTIVITY.IDLE',
		label: 'onDone [finish or failed] / onError',
		strokeColor: '#475569'
	},
	{
		id: 'edge-resolve-mining',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.RESOLVE',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING',
		label: 'always [isMiningExecution]',
		animated: true,
		strokeColor: '#2563eb'
	},
	{
		id: 'edge-resolve-navigating',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.RESOLVE',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.NAVIGATING',
		label: 'navigate_to',
		strokeColor: '#0ea5e9'
	},
	{
		id: 'edge-resolve-breaking',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.RESOLVE',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.BREAKING',
		label: 'break_block',
		strokeColor: '#0ea5e9'
	},
	{
		id: 'edge-resolve-open-window',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.RESOLVE',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.OPEN_WINDOW',
		label: 'open_window',
		strokeColor: '#0ea5e9'
	},
	{
		id: 'edge-resolve-transfer-item',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.RESOLVE',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.TRANSFER_ITEM',
		label: 'transfer_item',
		strokeColor: '#0ea5e9'
	},
	{
		id: 'edge-resolve-close-window',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.RESOLVE',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.CLOSE_WINDOW',
		label: 'close_window',
		strokeColor: '#0ea5e9'
	},
	{
		id: 'edge-resolve-placing',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.RESOLVE',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.PLACING',
		label: 'place_block',
		strokeColor: '#0ea5e9'
	},
	{
		id: 'edge-resolve-following',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.RESOLVE',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.FOLLOWING',
		label: 'follow_entity',
		strokeColor: '#0ea5e9'
	},
	{
		id: 'edge-resolve-fallback-decide-next',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.RESOLVE',
		target: 'MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
		label: 'unsupported -> failure',
		dashed: true,
		strokeColor: '#64748b'
	},
	{
		id: 'edge-mining-preconditions-searching',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.CHECKING_PRECONDITIONS',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.SEARCHING',
		label: 'always [canAttemptMining]',
		strokeColor: '#2563eb'
	},
	{
		id: 'edge-mining-preconditions-failed',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.CHECKING_PRECONDITIONS',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.TASK_FAILED',
		label: 'always [fail]',
		strokeColor: '#64748b'
	},
	{
		id: 'edge-mining-searching-checking-distance',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.SEARCHING',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.CHECKING_DISTANCE',
		label: 'BLOCKS_FOUND',
		animated: true,
		strokeColor: '#2563eb'
	},
	{
		id: 'edge-mining-checking-distance-breaking',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.CHECKING_DISTANCE',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.BREAKING',
		label: 'always [isBlockNearby]',
		strokeColor: '#2563eb'
	},
	{
		id: 'edge-mining-checking-distance-navigating',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.CHECKING_DISTANCE',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.NAVIGATING',
		label: 'always',
		strokeColor: '#2563eb'
	},
	{
		id: 'edge-mining-navigating-breaking',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.NAVIGATING',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.BREAKING',
		label: 'ARRIVED',
		animated: true,
		strokeColor: '#2563eb'
	},
	{
		id: 'edge-mining-navigating-searching',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.NAVIGATING',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.SEARCHING',
		label: 'NAVIGATION_FAILED [retry]',
		strokeColor: '#2563eb'
	},
	{
		id: 'edge-mining-navigating-failed',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.NAVIGATING',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.TASK_FAILED',
		label: 'NAVIGATION_FAILED [max]',
		strokeColor: '#64748b'
	},
	{
		id: 'edge-mining-breaking-checking-goal',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.BREAKING',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.CHECKING_GOAL',
		label: 'BROKEN',
		animated: true,
		strokeColor: '#2563eb'
	},
	{
		id: 'edge-mining-breaking-searching',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.BREAKING',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.SEARCHING',
		label: 'BREAKING_FAILED [retry]',
		strokeColor: '#2563eb'
	},
	{
		id: 'edge-mining-breaking-failed',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.BREAKING',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.TASK_FAILED',
		label: 'BREAKING_FAILED [max]',
		strokeColor: '#64748b'
	},
	{
		id: 'edge-mining-checking-goal-complete',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.CHECKING_GOAL',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.TASK_COMPLETED',
		label: 'always [goal complete]',
		strokeColor: '#16a34a'
	},
	{
		id: 'edge-mining-checking-goal-failed',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.CHECKING_GOAL',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.TASK_FAILED',
		label: 'always [inventory full]',
		strokeColor: '#64748b'
	},
	{
		id: 'edge-mining-checking-goal-navigating',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.CHECKING_GOAL',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.NAVIGATING',
		label: 'always [more blocks]',
		strokeColor: '#2563eb'
	},
	{
		id: 'edge-mining-checking-goal-searching',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.CHECKING_GOAL',
		target: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.SEARCHING',
		label: 'always [search again]',
		strokeColor: '#2563eb'
	},
	{
		id: 'edge-mining-completed-decide-next',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.TASK_COMPLETED',
		target: 'MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
		label: 'record success',
		dashed: true,
		strokeColor: '#16a34a'
	},
	{
		id: 'edge-mining-failed-decide-next',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.MINING.TASK_FAILED',
		target: 'MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
		label: 'record failure',
		dashed: true,
		strokeColor: '#64748b'
	},
	{
		id: 'edge-primitive-navigating-decide-next',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.NAVIGATING',
		target: 'MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
		label: 'ARRIVED / FAILED / ERROR',
		strokeColor: '#0ea5e9'
	},
	{
		id: 'edge-primitive-breaking-decide-next',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.BREAKING',
		target: 'MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
		label: 'BROKEN / FAILED / ERROR',
		strokeColor: '#0ea5e9'
	},
	{
		id: 'edge-primitive-open-window-decide-next',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.OPEN_WINDOW',
		target: 'MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
		label: 'WINDOW_OPENED / FAILED',
		strokeColor: '#0ea5e9'
	},
	{
		id: 'edge-primitive-transfer-item-decide-next',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.TRANSFER_ITEM',
		target: 'MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
		label: 'TRANSFERRED / FAILED',
		strokeColor: '#0ea5e9'
	},
	{
		id: 'edge-primitive-close-window-decide-next',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.CLOSE_WINDOW',
		target: 'MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
		label: 'CLOSED / FAILED',
		strokeColor: '#0ea5e9'
	},
	{
		id: 'edge-primitive-placing-decide-next',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.PLACING',
		target: 'MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
		label: 'PLACED / FAILED',
		strokeColor: '#0ea5e9'
	},
	{
		id: 'edge-primitive-following-decide-next',
		source: 'MAIN_ACTIVITY.TASKS.EXECUTING.FOLLOWING',
		target: 'MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
		label: 'STOPPED / FAILED',
		strokeColor: '#0ea5e9'
	},
	{
		id: 'edge-agent-loop-decide-next-thinking',
		source: 'MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
		target: 'MAIN_ACTIVITY.TASKS.THINKING',
		label: 'always [hasCurrentGoal]',
		animated: true,
		strokeColor: '#0f766e'
	},
	{
		id: 'edge-agent-loop-decide-next-idle',
		source: 'MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
		target: 'MAIN_ACTIVITY.IDLE',
		label: 'always [stuck or no goal]',
		strokeColor: '#475569'
	}
]

const escapeXml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;')

const toCellId = (path: string) =>
	`state-${path.replaceAll('.', '-').replaceAll('#', '')}`

const getStateLabel = (path: string) => {
	if (path === 'MAIN_ACTIVITY.RESUMING') {
		return 'RESUMING'
	}

	return path.split('.').at(-1) ?? path
}

const getPalette = (path: string) => {
	if (path === 'MAIN_ACTIVITY' || path === 'MONITORING') {
		return { fill: '#f8fafc', stroke: '#334155', text: '#0f172a' }
	}

	if (path === 'MAIN_ACTIVITY.RESUMING') {
		return { fill: '#f1f5f9', stroke: '#64748b', text: '#0f172a' }
	}

	if (path.includes('URGENT_NEEDS')) {
		return { fill: '#fff7ed', stroke: '#d97706', text: '#7c2d12' }
	}

	if (path.includes('COMBAT')) {
		return { fill: '#fef2f2', stroke: '#dc2626', text: '#7f1d1d' }
	}

	if (path.includes('MINING')) {
		return { fill: '#eff6ff', stroke: '#2563eb', text: '#1e3a8a' }
	}

	if (path.includes('TASKS')) {
		return { fill: '#ecfeff', stroke: '#0f766e', text: '#134e4a' }
	}

	if (path.includes('MONITORING')) {
		return { fill: '#f8fafc', stroke: '#475569', text: '#0f172a' }
	}

	return { fill: '#ffffff', stroke: '#334155', text: '#111827' }
}

const buildStateStyle = (layout: StateLayout) => {
	const palette = getPalette(layout.path)

	if (layout.kind === 'compound' || layout.kind === 'parallel') {
		return [
			'rounded=1',
			'whiteSpace=wrap',
			'html=1',
			'fontStyle=1',
			'fontSize=16',
			'spacingTop=26',
			'spacingLeft=16',
			'align=left',
			'verticalAlign=top',
			`fillColor=${palette.fill}`,
			`strokeColor=${palette.stroke}`,
			`fontColor=${palette.text}`,
			'strokeWidth=2',
			layout.kind === 'parallel' ? 'dashed=1' : ''
		]
			.filter(Boolean)
			.join(';')
	}

	if (layout.kind === 'history') {
		return [
			'ellipse',
			'whiteSpace=wrap',
			'html=1',
			'fontStyle=1',
			'fontSize=12',
			`fillColor=${palette.fill}`,
			`strokeColor=${palette.stroke}`,
			`fontColor=${palette.text}`,
			'strokeWidth=2'
		].join(';')
	}

	return [
		'rounded=1',
		'whiteSpace=wrap',
		'html=1',
		'fontSize=13',
		'fontStyle=1',
		'align=center',
		'verticalAlign=middle',
		`fillColor=${palette.fill}`,
		`strokeColor=${palette.stroke}`,
		`fontColor=${palette.text}`,
		'strokeWidth=2'
	].join(';')
}

const buildStateValue = (layout: StateLayout) => {
	const label = getStateLabel(layout.path)

	if (layout.kind === 'history') {
		return `<div style="text-align:center;"><b>H</b><br/><span style="font-size:10px;">${escapeXml(
			layout.summary
		)}</span></div>`
	}

	return `<div><b>${escapeXml(label)}</b><br/><span style="font-size:10px;">${escapeXml(
		layout.summary
	)}</span></div>`
}

const buildNoteStyle = (note: NoteLayout) =>
	[
		'shape=note',
		'whiteSpace=wrap',
		'html=1',
		'fontSize=13',
		'align=left',
		'verticalAlign=top',
		'spacingTop=18',
		'spacingLeft=12',
		`fillColor=${note.fillColor ?? '#ffffff'}`,
		`strokeColor=${note.strokeColor ?? '#334155'}`,
		'strokeWidth=1.5'
	].join(';')

const buildEdgeStyle = (edge: EdgeLayout) => {
	const base = [
		'edgeStyle=orthogonalEdgeStyle',
		'rounded=1',
		'orthogonalLoop=1',
		'jettySize=auto',
		'html=1',
		'endArrow=blockThin',
		'endFill=1',
		'strokeWidth=2',
		`strokeColor=${edge.strokeColor ?? '#334155'}`,
		edge.dashed ? 'dashed=1' : '',
		edge.animated ? 'flowAnimation=1' : '',
		edge.exitX !== undefined ? `exitX=${edge.exitX}` : '',
		edge.exitY !== undefined ? `exitY=${edge.exitY}` : '',
		edge.entryX !== undefined ? `entryX=${edge.entryX}` : '',
		edge.entryY !== undefined ? `entryY=${edge.entryY}` : ''
	]

	return base.filter(Boolean).join(';')
}

const getParentPath = (path: string) => {
	const lastDot = path.lastIndexOf('.')
	return lastDot === -1 ? null : path.slice(0, lastDot)
}

const collectStatePaths = (
	states: Record<string, any> | undefined,
	path: string[] = []
): string[] => {
	if (!states) {
		return []
	}

	return Object.entries(states).flatMap(([name, config]) => {
		const currentPath = [...path, name]
		return [
			currentPath.join('.'),
			...collectStatePaths(config.states, currentPath)
		]
	})
}

const validateLayoutCoverage = (actualPaths: string[]) => {
	const layoutPaths = outputStateLayouts.map(layout => layout.path)
	const missing = actualPaths.filter(path => !layoutPaths.includes(path))
	const extra = layoutPaths.filter(path => !actualPaths.includes(path))

	if (missing.length === 0 && extra.length === 0) {
		return
	}

	throw new Error(
		[
			'HSM draw.io layout is out of sync with the machine definition.',
			missing.length > 0 ? `Missing layout paths: ${missing.join(', ')}` : '',
			extra.length > 0 ? `Extra layout paths: ${extra.join(', ')}` : ''
		]
			.filter(Boolean)
			.join(' ')
	)
}

export const buildHsmDrawioDiagram = (): HsmDrawioDiagram => {
	const statePaths = collectStatePaths(machine.config.states)
	validateLayoutCoverage(statePaths)

	const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']

	cells.push(
		...outputStateLayouts.map(layout => {
			const parentPath = getParentPath(layout.path)
			const parentId = parentPath ? toCellId(parentPath) : '1'
			return `<mxCell id="${toCellId(layout.path)}" value="${escapeXml(
				buildStateValue(layout)
			)}" style="${buildStateStyle(layout)}" vertex="1" parent="${parentId}"><mxGeometry x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" as="geometry"/></mxCell>`
		})
	)

	cells.push(
		...noteLayouts.map(note => {
			const value = `<div><b>${escapeXml(note.title)}</b><br/><span style="font-size:11px; white-space:pre-line;">${escapeXml(
				note.body
			)}</span></div>`
			return `<mxCell id="${note.id}" value="${escapeXml(
				value
			)}" style="${buildNoteStyle(note)}" vertex="1" parent="1"><mxGeometry x="${note.x}" y="${note.y}" width="${note.width}" height="${note.height}" as="geometry"/></mxCell>`
		})
	)

	cells.push(
		...edgeLayouts.map(edge => {
			const label = edge.label ? escapeXml(edge.label) : ''
			return `<mxCell id="${edge.id}" value="${label}" style="${buildEdgeStyle(
				edge
			)}" edge="1" parent="1" source="${
				edge.source.startsWith('note-') ? edge.source : toCellId(edge.source)
			}" target="${
				edge.target.startsWith('note-') ? edge.target : toCellId(edge.target)
			}"><mxGeometry relative="1" as="geometry"/></mxCell>`
		})
	)

	return {
		xml: `<mxGraphModel dx="2200" dy="1400" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="2600" pageHeight="1600" math="0" shadow="0"><root>${cells.join(
			''
		)}</root></mxGraphModel>`,
		statePaths,
		animatedEdgeIds: edgeLayouts
			.filter(edge => edge.animated)
			.map(edge => edge.id)
	}
}
