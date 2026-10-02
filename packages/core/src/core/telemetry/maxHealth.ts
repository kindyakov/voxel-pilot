function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fields(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) &&
		value[0] === 'container' &&
		Array.isArray(value[1])
		? value[1].filter(record)
		: []
}

/** Resolve decoded wire identifiers from this connection's registry, never defaults. */
export function maxHealthSource(registry: unknown): {
	event: string
	field: string
	aliases: ReadonlySet<string>
} | null {
	if (
		!record(registry) ||
		!record(registry.attributesByName) ||
		!record(registry.attributesByName.maxHealth) ||
		!record(registry.protocol)
	)
		return null
	const resource = registry.attributesByName.maxHealth.resource
	const play = registry.protocol.play
	if (
		typeof resource !== 'string' ||
		!record(play) ||
		!record(play.toClient) ||
		!record(play.toClient.types)
	)
		return null
	const types = play.toClient.types
	const event = types.packet_update_attributes
		? 'update_attributes'
		: 'entity_update_attributes'
	const properties = fields(types[`packet_${event}`]).find(
		field => field.name === 'properties'
	)?.type
	if (
		!Array.isArray(properties) ||
		properties[0] !== 'array' ||
		!record(properties[1])
	)
		return null
	const identity = fields(properties[1].type).find(
		field => field.name === 'name' || field.name === 'key'
	)
	if (!identity || typeof identity.name !== 'string') return null
	const aliases = new Set([resource])
	const type = identity.type
	if (
		Array.isArray(type) &&
		type[0] === 'mapper' &&
		record(type[1]) &&
		record(type[1].mappings)
	) {
		for (const value of Object.values(type[1].mappings)) {
			if (typeof value === 'string' && /(?:^|[.:])max_?health$/i.test(value))
				aliases.add(value)
		}
	} else if (type !== 'string') return null
	return { event, field: identity.name, aliases }
}

/** Applies the three native modifier operations to one actual server observation. */
function effectiveValue(property: Record<string, unknown>): number | null {
	if (
		typeof property.value !== 'number' ||
		!Number.isFinite(property.value) ||
		!Array.isArray(property.modifiers)
	)
		return null
	let addition = 0,
		baseMultiplier = 0
	const multipliers: number[] = []
	for (const modifier of property.modifiers) {
		if (
			!record(modifier) ||
			typeof modifier.amount !== 'number' ||
			!Number.isFinite(modifier.amount)
		)
			return null
		switch (modifier.operation) {
			case 0:
				addition += modifier.amount
				break
			case 1:
				baseMultiplier += modifier.amount
				break
			case 2:
				multipliers.push(1 + modifier.amount)
				break
			default:
				return null
		}
	}
	const base = property.value + addition
	let value = base + base * baseMultiplier
	for (const multiplier of multipliers) value *= multiplier
	return Number.isFinite(value) && value > 0 ? value : null
}

export function readMaxHealth(
	packet: unknown,
	entityId: number,
	source: NonNullable<ReturnType<typeof maxHealthSource>>
): number | null {
	if (
		!record(packet) ||
		!Number.isSafeInteger(entityId) ||
		packet.entityId !== entityId ||
		!Array.isArray(packet.properties)
	)
		return null
	const matching = packet.properties.filter(property => {
		if (!record(property)) return false
		const identity = property[source.field]
		return typeof identity === 'string' && source.aliases.has(identity)
	})
	return matching.length === 1 && record(matching[0])
		? effectiveValue(matching[0])
		: null
}
