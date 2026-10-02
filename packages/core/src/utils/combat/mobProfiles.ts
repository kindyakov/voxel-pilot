/** Vanilla Java 1.20.4 base FOLLOW_RANGE attributes, not attack or safe distances.
 * Verified against Mojang server 8dd1a28015f51b1803213892b50b7b4fc76e594d
 * and server mappings c1cafe916dd8b58ed1fe0564fc8f786885224e62.
 * Server attributes/modifiers can differ: these only bound preventive defense.
 */
export const vanillaFollowRange: Readonly<Record<string, number>> = {
	creeper: 16,
	zombie: 35,
	skeleton: 16,
	spider: 16,
	enderman: 64,
	witch: 16,
	pillager: 32,
	vindicator: 12,
	slime: 16,
	wither_skeleton: 16,
	blaze: 48
}

type MobPolicyOverride =
	| 'passive'
	| 'avoid'
	| 'uncertain'
	| 'slime_size'
	| 'spider_light'
	| 'enderman_anger'
	| 'neutral_anger'
	| 'rabbit_variant'

/** Exceptions to registry categories, not a second catalogue of ordinary mobs.
 * A category is a baseline, not evidence of a mob's current target.
 * Conditions without a reliable observer remain uncertain, never attackable.
 */
export const mobPolicyOverrides: Readonly<
	Partial<Record<string, MobPolicyOverride>>
> = {
	wither: 'avoid',
	ender_dragon: 'avoid',
	warden: 'avoid',
	// The 1.20.x registry groups undead horses with hostile mobs.
	skeleton_horse: 'passive',
	zombie_horse: 'passive',
	// These need signals/conditions that the baseline model does not observe.
	giant: 'uncertain',
	piglin: 'uncertain',
	zombified_piglin: 'uncertain',
	polar_bear: 'uncertain',
	iron_golem: 'uncertain',
	goat: 'uncertain',
	pufferfish: 'uncertain',
	slime: 'slime_size',
	spider: 'spider_light',
	cave_spider: 'spider_light',
	enderman: 'enderman_anger',
	wolf: 'neutral_anger',
	bee: 'neutral_anger',
	rabbit: 'rabbit_variant'
}
