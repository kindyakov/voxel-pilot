import Ajv from 'ajv'

type Position = { x: number; y: number; z: number }

const ajv = new Ajv({ allErrors: true, strictNumbers: true })
const position = {
	type: 'object',
	additionalProperties: false,
	properties: {
		x: { type: 'number' },
		y: { type: 'number' },
		z: { type: 'number' }
	},
	required: ['x', 'y', 'z']
}
const positiveNumber = { type: 'number', exclusiveMinimum: 0 }
const face = {
	...position,
	enum: [
		{ x: 1, y: 0, z: 0 },
		{ x: -1, y: 0, z: 0 },
		{ x: 0, y: 1, z: 0 },
		{ x: 0, y: -1, z: 0 },
		{ x: 0, y: 0, z: 1 },
		{ x: 0, y: 0, z: -1 }
	]
}
const nonEmptyString = { type: 'string', pattern: '\\S' }
export const windowZones = [
	'player_inventory',
	'hotbar',
	'container',
	'input',
	'fuel',
	'output'
] as const
export type WindowZone = (typeof windowZones)[number]
const zone = { type: 'string', enum: [...windowZones] }

// The schema is used both by the model and by the local, non-coercing parser.
// Provider strict mode requires every property; this contract distinguishes omission from null.
const define =
	<Args>() =>
	<Name extends string>(
		name: Name,
		description: string,
		parameters: Record<string, unknown>,
		summary: (args: Args) => string
	) => {
		const validate = ajv.compile<Args>(parameters)
		return {
			tool: {
				type: 'function' as const,
				name,
				description,
				strict: false,
				parameters
			},
			parse: (args: unknown) => {
				if (!validate(args))
					return {
						ok: false as const,
						reason: `Execution tool "${name}": ${ajv.errorsText(validate.errors)}`
					}
				return {
					ok: true as const,
					execution: { toolName: name, args: structuredClone(args) }
				}
			},
			summarize: (args: unknown) => {
				if (!validate(args)) throw new Error(`Invalid arguments for ${name}`)
				return summary(args)
			}
		}
	}

export const executionDefinitions = {
	navigate_to: define<{ position: Position; range?: number }>()(
		'navigate_to',
		'Navigate to a target position.',
		{
			type: 'object',
			additionalProperties: false,
			properties: { position, range: positiveNumber },
			required: ['position']
		},
		() => 'Move to target position'
	),
	break_block: define<{ position: Position }>()(
		'break_block',
		'Break a block at a target position.',
		{
			type: 'object',
			additionalProperties: false,
			properties: { position },
			required: ['position']
		},
		() => 'Break target block'
	),
	mine_resource: define<{
		block_name: string
		resource_name?: string
		count: number
	}>()(
		'mine_resource',
		'Collect count NEW resource_name items by batch mining block_name. Specify the exact output item; clarify ambiguous requests in chat first. Ore drops may use normal and deepslate sources; exact ore blocks require Silk Touch.',
		{
			type: 'object',
			additionalProperties: false,
			properties: {
				block_name: nonEmptyString,
				resource_name: nonEmptyString,
				count: { type: 'integer', minimum: 1, maximum: 64 }
			},
			required: ['block_name', 'count']
		},
		args => `Mine ${args.count} ${args.block_name}`
	),
	tasks_create: define<{
		block_name: string
		resource_name?: string
		count: number
	}>()(
		'tasks_create',
		'Save a mining task for later without starting it. Returns a task id.',
		{
			type: 'object',
			additionalProperties: false,
			properties: {
				block_name: nonEmptyString,
				resource_name: nonEmptyString,
				count: { type: 'integer', minimum: 1, maximum: 64 }
			},
			required: ['block_name', 'count']
		},
		args => `Create task: mine ${args.count} ${args.block_name}`
	),
	tasks_start: define<{ task_id: string }>()(
		'tasks_start',
		'Start a suspended persistent task by id; also resumes an orphaned active row with no live owner. Only when idle with no active task.',
		{
			type: 'object',
			additionalProperties: false,
			properties: { task_id: nonEmptyString },
			required: ['task_id']
		},
		() => 'Start stored task'
	),
	tasks_cancel: define<{ task_id: string }>()(
		'tasks_cancel',
		'Cancel a suspended or active persistent task by id.',
		{
			type: 'object',
			additionalProperties: false,
			properties: { task_id: nonEmptyString },
			required: ['task_id']
		},
		() => 'Cancel stored task'
	),
	place_block: define<{
		block_name: string
		position: Position
		face_vector?: Position
	}>()(
		'place_block',
		'Place a block from inventory.',
		{
			type: 'object',
			additionalProperties: false,
			properties: { block_name: nonEmptyString, position, face_vector: face },
			required: ['block_name', 'position']
		},
		args => `Place ${args.block_name}`
	),
	follow_entity: define<{
		entity_name?: string
		entity_type?: string
		max_distance?: number
		distance?: number
	}>()(
		'follow_entity',
		'Follow the nearest matching entity until cancelled.',
		{
			type: 'object',
			additionalProperties: false,
			properties: {
				entity_name: nonEmptyString,
				entity_type: nonEmptyString,
				max_distance: positiveNumber,
				distance: positiveNumber
			},
			anyOf: [{ required: ['entity_name'] }, { required: ['entity_type'] }]
		},
		() => 'Follow target entity'
	),
	open_window: define<{ position: Position }>()(
		'open_window',
		'Open a nearby window-bearing block.',
		{
			type: 'object',
			additionalProperties: false,
			properties: { position },
			required: ['position']
		},
		() => 'Open window'
	),
	transfer_item: define<{
		source_zone: WindowZone
		dest_zone: WindowZone
		item_name: string
		count: number
	}>()(
		'transfer_item',
		'Transfer an item between different semantic window zones.',
		{
			type: 'object',
			additionalProperties: false,
			properties: {
				source_zone: zone,
				dest_zone: zone,
				item_name: nonEmptyString,
				count: { type: 'integer', minimum: 1 }
			},
			required: ['source_zone', 'dest_zone', 'item_name', 'count'],
			not: {
				anyOf: windowZones.map(value => ({
					properties: {
						source_zone: { const: value },
						dest_zone: { const: value }
					}
				}))
			}
		},
		args => `Transfer ${args.item_name}`
	),
	close_window: define<Record<string, never>>()(
		'close_window',
		'Close the currently open window.',
		{
			type: 'object',
			additionalProperties: false,
			properties: {},
			required: []
		},
		() => 'Close window'
	)
}

export type ExecutionToolName = keyof typeof executionDefinitions
export type PendingExecution = Extract<
	ReturnType<(typeof executionDefinitions)[ExecutionToolName]['parse']>,
	{ ok: true }
>['execution']

export const isExecutionName = (name: string): name is ExecutionToolName =>
	Object.hasOwn(executionDefinitions, name)

export const parseExecution = (name: string, args: unknown) => {
	if (!isExecutionName(name))
		return { ok: false as const, reason: `Unknown execution tool: ${name}` }
	return executionDefinitions[name].parse(args)
}

export const summarizeExecution = (execution: PendingExecution): string =>
	executionDefinitions[execution.toolName].summarize(execution.args)
