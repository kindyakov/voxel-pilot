import type { Bot } from '@/types/index.js'

import { type RuntimeFacts, measured } from './facts.js'
import { maxHealthSource, readMaxHealth } from './maxHealth.js'

/** Only events from the live native connection establish measurement provenance. */
export function observeNativeFacts(
	bot: Bot,
	publish: (facts: Partial<RuntimeFacts>) => void
): () => void {
	let active = true
	const onHealth = () => {
		if (!active) return
		const facts: Partial<RuntimeFacts> = {
			...(Number.isFinite(bot.health) && bot.health >= 0
				? { health: measured(bot.health) }
				: {}),
			...(Number.isFinite(bot.food) && bot.food >= 0
				? { food: measured(bot.food) }
				: {})
		}
		if (Object.keys(facts).length) publish(facts)
	}
	const onMove = () => {
		if (!active) return
		const position = bot.entity?.position
		if (
			!position ||
			![position.x, position.y, position.z].every(Number.isFinite)
		)
			return
		publish({
			position: measured(
				Object.freeze({ x: position.x, y: position.y, z: position.z })
			)
		})
	}
	bot.on('health', onHealth)
	bot.on('move', onMove)
	// Mineflayer's entity cache drops `name` identities on several supported protocols.
	// Observe the decoded own-entity packet locally without altering native gameplay data.
	let source: ReturnType<typeof maxHealthSource> = null
	const attributes = (event: string) => (packet: unknown) => {
		if (!active || !bot.entity) return
		// Negotiation may install the registry after createBot returns.
		source ??= maxHealthSource(bot.registry)
		if (!source || source.event !== event) return
		const value = readMaxHealth(packet, bot.entity.id, source)
		if (value !== null) publish({ maxHealth: measured(value) })
	}
	const onLegacyAttributes = attributes('update_attributes')
	const onAttributes = attributes('entity_update_attributes')
	bot._client.on('update_attributes', onLegacyAttributes)
	bot._client.on('entity_update_attributes', onAttributes)
	return () => {
		active = false
		bot.off('health', onHealth)
		bot.off('move', onMove)
		bot._client.off('update_attributes', onLegacyAttributes)
		bot._client.off('entity_update_attributes', onAttributes)
	}
}
