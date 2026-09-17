export const getActorEventProperty = (
	event: unknown,
	property: string
): unknown =>
	event !== null && (typeof event === 'object' || typeof event === 'function')
		? Reflect.get(event, property)
		: undefined

export const getActorError = (event: unknown): unknown =>
	getActorEventProperty(event, 'error') ?? new Error('Unknown actor error')
