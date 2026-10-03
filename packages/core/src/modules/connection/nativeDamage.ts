import type { Bot, Entity } from '@/types/index.js'
import { Vec3 } from 'vec3'

export interface NativeDamageObservation {
	sourceId: number | null
	sourcePosition: Vec3 | null
	ranged: boolean
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function integer(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= 0 &&
		value <= 0x7fffffff
	)
}

function position(value: unknown): Vec3 | null {
	return record(value) &&
		typeof value.x === 'number' &&
		Number.isFinite(value.x) &&
		typeof value.y === 'number' &&
		Number.isFinite(value.y) &&
		typeof value.z === 'number' &&
		Number.isFinite(value.z)
		? new Vec3(value.x, value.y, value.z)
		: null
}

/** Only the decoded layout we understand grants source attribution. */
function supportsDamagePacket(registry: unknown): boolean {
	if (!record(registry) || !record(registry.protocol)) return false
	const play = registry.protocol.play
	if (!record(play) || !record(play.toClient) || !record(play.toClient.types))
		return false
	const packet = play.toClient.types.packet_damage_event
	if (
		!Array.isArray(packet) ||
		packet[0] !== 'container' ||
		!Array.isArray(packet[1])
	)
		return false
	const fields = packet[1].filter(record)
	for (const name of [
		'entityId',
		'sourceTypeId',
		'sourceCauseId',
		'sourceDirectId'
	])
		if (!fields.some(field => field.name === name && field.type === 'varint'))
			return false
	const source = fields.find(field => field.name === 'sourcePosition')?.type
	return (
		Array.isArray(source) && source[0] === 'option' && source[1] === 'vec3f64'
	)
}

const projectileDamageTypes = new Set([
	'minecraft:arrow',
	'minecraft:trident',
	'minecraft:mob_projectile',
	'minecraft:thrown',
	'minecraft:fireball',
	'minecraft:unattributed_fireball',
	'minecraft:wither_skull',
	'minecraft:fireworks',
	'minecraft:wind_charge'
])

interface DamageSession {
	active: boolean
	damageTypes: Map<number, string>
}

// One bounded server registry per connection, collected before the HSM exists.
const sessions = new WeakMap<Bot, DamageSession>()
const maxDamageTypes = 4096
const resourceName = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length <= 256 &&
	/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value)

function compound(value: unknown): Record<string, unknown> | null {
	return record(value) && value.type === 'compound' && record(value.value)
		? value.value
		: null
}

function codecDamageTypes(codec: unknown): Map<number, string> | null {
	const registry = compound(codec)
	const damage = compound(registry?.['minecraft:damage_type'])
	if (!damage) return null
	const list = damage.value
	if (
		!record(list) ||
		list.type !== 'list' ||
		!record(list.value) ||
		list.value.type !== 'compound' ||
		!Array.isArray(list.value.value) ||
		list.value.value.length > maxDamageTypes
	)
		return new Map()
	const entries = new Map<number, string>()
	for (const entry of list.value.value) {
		if (
			!record(entry) ||
			!record(entry.id) ||
			!record(entry.name) ||
			entry.id.type !== 'int' ||
			entry.name.type !== 'string' ||
			!integer(entry.id.value) ||
			!resourceName(entry.name.value) ||
			entries.has(entry.id.value)
		)
			return new Map()
		entries.set(entry.id.value, entry.name.value)
	}
	return entries
}

/** Call immediately after native bot creation, before login/configuration or botReady. */
export function startNativeDamageSession(bot: Bot): () => void {
	const previous = sessions.get(bot)
	if (previous?.active) throw new Error('Native damage session already exists')
	const session: DamageSession = { active: true, damageTypes: new Map() }
	sessions.set(bot, session)
	const captureCodec = (codec: unknown) => {
		const damageTypes = codecDamageTypes(codec)
		if (session.active && damageTypes) session.damageTypes = damageTypes
	}
	const onLogin = (packet: unknown) => {
		if (record(packet)) captureCodec(packet.dimensionCodec)
	}
	const onRegistry = (packet: unknown) => {
		if (!session.active || !record(packet)) return
		if (packet.codec !== undefined) {
			session.damageTypes = codecDamageTypes(packet.codec) ?? new Map()
			return
		}
		if (packet.id !== 'minecraft:damage_type') return
		const damageTypes = new Map<number, string>()
		if (
			Array.isArray(packet.entries) &&
			packet.entries.length <= maxDamageTypes
		) {
			for (const [index, entry] of packet.entries.entries()) {
				if (!record(entry) || !resourceName(entry.key)) {
					damageTypes.clear()
					break
				}
				damageTypes.set(index, entry.key)
			}
		}
		session.damageTypes = damageTypes
	}
	bot._client.on('login', onLogin)
	bot._client.on('registry_data', onRegistry)
	return () => {
		if (!session.active) return
		session.active = false
		session.damageTypes.clear()
		bot._client.off('login', onLogin)
		bot._client.off('registry_data', onRegistry)
		if (sessions.get(bot) === session) sessions.delete(bot)
	}
}

/** Raw modern packet owns the hit; entityHurt remains the legacy/plugin fallback. */
export function observeNativeDamage(
	bot: Bot,
	publish: (damage: NativeDamageObservation) => void
): () => void {
	const ownSession = sessions.has(bot) ? null : startNativeDamageSession(bot)
	const session = sessions.get(bot)!
	let active = true
	let pendingNativeHurt: object | null = null
	const onPacket = (packet: unknown) => {
		if (
			!active ||
			!session.active ||
			!record(packet) ||
			packet.entityId !== bot.entity?.id
		)
			return
		// Runs before Mineflayer's synchronous entityHurt, even when its plugin was registered first.
		const hit = {}
		pendingNativeHurt = hit
		queueMicrotask(() => {
			if (pendingNativeHurt === hit) pendingNativeHurt = null
		})
		if (!supportsDamagePacket(bot.registry)) return
		if (
			![
				packet.entityId,
				packet.sourceTypeId,
				packet.sourceCauseId,
				packet.sourceDirectId
			].every(integer) ||
			(packet.sourcePosition != null && !position(packet.sourcePosition))
		)
			return
		const sourceId =
			packet.sourceCauseId === 0 ? null : Number(packet.sourceCauseId) - 1
		const directId =
			packet.sourceDirectId === 0 ? null : Number(packet.sourceDirectId) - 1
		const source = sourceId === null ? undefined : bot.entities[sourceId]
		const direct = directId === null ? undefined : bot.entities[directId]
		const directSpecies = direct?.name
			? bot.registry.entitiesByName[direct.name]
			: undefined
		publish({
			sourceId,
			sourcePosition:
				position(packet.sourcePosition) ??
				(source?.id === sourceId ? position(source?.position) : null),
			ranged:
				(direct?.id === directId &&
					direct?.isValid !== false &&
					directSpecies?.type === 'projectile') ||
				projectileDamageTypes.has(
					session.damageTypes.get(Number(packet.sourceTypeId)) ?? ''
				)
		})
	}
	const onHurt = (entity?: Entity, source?: Entity) => {
		if (!active || !session.active || !entity || entity.id !== bot.entity?.id)
			return
		if (pendingNativeHurt) {
			pendingNativeHurt = null
			return
		}
		publish({
			sourceId: integer(source?.id) ? source.id : null,
			sourcePosition: position(source?.position),
			ranged: false
		})
	}
	bot._client.prependListener('damage_event', onPacket)
	bot.on('entityHurt', onHurt)
	return () => {
		active = false
		pendingNativeHurt = null
		bot._client.off('damage_event', onPacket)
		bot.off('entityHurt', onHurt)
		ownSession?.()
	}
}
