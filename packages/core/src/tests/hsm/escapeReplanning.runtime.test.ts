import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import type { PartiallyComputedPath } from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

import type { ThreatObservation } from '@/hsm/context.js'

import { EscapeRuntime } from '@/utils/combat/escapeRuntime.js'
import { EscapeSafety } from '@/utils/combat/escapeSafety.js'

import { createEntityFixture, createHarness } from './fixtures/handoffBot.js'
import { fixtureLogger as Logger } from './fixtures/services.js'

const threat = (entityId: number, x: number, z: number): ThreatObservation => ({
	entityId,
	kind: 'hostile',
	position: new Vec3(x, 64, z),
	distance: Math.hypot(x, z),
	lastObservedAt: Date.now(),
	observed: true,
	creeper: null
})

/** Exercise native slice boundaries without replacing any result/path. */
const deferNativeSearch = (
	t: TestContext,
	bot: ReturnType<typeof createHarness>['bot'],
	stage: 'candidate' | 'movement'
) => {
	const getPath = bot.pathfinder.getPathFromTo.bind(bot.pathfinder)
	const now = performance.now.bind(performance)
	// Two candidate slices are the minimized goal-null reproduction. Movement
	// stays partial across the original 4 setup + 16 measurement frames.
	const partialSlices = stage === 'candidate' ? 2 : 20
	const statuses: PartiallyComputedPath['status'][] = []
	const activeGoals: boolean[] = []
	let starts = 0
	t.mock.method(
		bot.pathfinder,
		'getPathFromTo',
		function* (...args: Parameters<typeof getPath>) {
			const generator = getPath(...args)
			const candidate = args[3]?.tickTimeout !== undefined
			if (candidate !== (stage === 'candidate') || starts++ !== 0)
				return yield* generator
			const elapsed = (args[3]?.tickTimeout ?? bot.pathfinder.tickTimeout) + 1
			assert.ok(
				partialSlices * elapsed <
					(args[3]?.timeout ?? bot.pathfinder.thinkTimeout),
				'delayed slices must fit the native overall search budget'
			)
			let slices = 0
			const compute = <T>(run: () => T, initial = false): T => {
				const base = now() + Math.min(slices, partialSlices) * elapsed
				let calls = 0
				const clock = t.mock.method(performance, 'now', () =>
					slices < partialSlices
						? base + (++calls <= (initial ? 2 : 1) ? 0 : elapsed)
						: now() + partialSlices * elapsed
				)
				try {
					return run()
				} finally {
					clock.mock.restore()
					slices++
				}
			}
			const first = compute(() => generator.next(), true)
			assert.ok(!first.done)
			statuses.push(first.value.result.status)
			activeGoals.push(Boolean(bot.pathfinder.goal))
			const context = first.value.astarContext
			const nativeCompute = context.compute.bind(context)
			// Candidate search resumes the iterator; native movement resumes compute directly.
			t.mock.method(context, 'compute', () => {
				const result = compute<PartiallyComputedPath>(nativeCompute)
				statuses.push(result.status)
				activeGoals.push(Boolean(bot.pathfinder.goal))
				return result
			})
			yield first.value
			for (const value of generator) {
				assert.equal(
					value.astarContext,
					context,
					'continue the same native context'
				)
				yield value
			}
		}
	)
	return {
		partialSlices,
		statuses,
		activeGoals,
		get starts() {
			return starts
		}
	}
}

for (const delayedStage of [null, 'candidate', 'movement'] as const) {
	test(`real escape keeps moving on its route while distant mobs move${delayedStage ? ` after native ${delayedStage} partials` : ''}`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
		const { bot, actor, enemy, step } = createHarness(true, '1.20.6')
		const deferred = delayedStage
			? deferNativeSearch(t, bot, delayedStage)
			: null
		let readyPath = false
		let activePath: PartiallyComputedPath['path'] = []
		const resetPath = () => {
			readyPath = false
		}
		const observePath = (result: PartiallyComputedPath) => {
			readyPath = result.status === 'success' && result.path.length > 0
			activePath = result.path
		}
		bot.on('goal_updated', resetPath)
		bot.on('path_reset', resetPath)
		bot.on('path_update', observePath)
		t.after(() => {
			bot.off('goal_updated', resetPath)
			bot.off('path_reset', resetPath)
			bot.off('path_update', observePath)
			actor.stop()
		})
		enemy.position = new Vec3(18, 64, 0)
		const distant = createEntityFixture({
			...enemy,
			id: 2,
			position: new Vec3(0, 64, 45)
		})
		bot.entities = { 1: enemy, 2: distant }
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		await flush()
		// Native search uses wall time; mocked physics frames are not readiness.
		const deadline =
			performance.now() +
			actor.getSnapshot().context.preferences.escapeRouteTimeoutMs +
			bot.pathfinder.thinkTimeout
		assert.ok(Number.isFinite(deadline))
		while (
			!(
				readyPath &&
				bot.pathfinder.goal &&
				bot.pathfinder.isMoving() &&
				bot.controlState.forward
			)
		) {
			assert.ok(
				performance.now() < deadline,
				'native escape route must become ready within its search deadlines'
			)
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		const context = actor.getSnapshot().context
		assert.equal(
			new EscapeSafety(
				bot.entity.position,
				context.threats,
				context.preferences
			).allowsPath(bot.entity.position, activePath, false, 0),
			true
		)
		if (deferred) {
			assert.equal(deferred.starts, 1, 'continue the same native search')
			assert.deepEqual(
				deferred.statuses.slice(0, deferred.partialSlices),
				Array(deferred.partialSlices).fill('partial')
			)
			assert.equal(deferred.statuses.at(-1), 'success')
			assert.ok(
				deferred.activeGoals.every(
					value => value === (delayedStage === 'movement')
				),
				'candidate completion precedes goal activation; movement completion follows it'
			)
		}
		const goal = bot.pathfinder.goal
		assert.ok(goal)
		const before = bot.entity.position.clone()
		for (let i = 0; i < 16; i++) {
			distant.position.z = i % 2 === 0 ? 45 : 49
			t.mock.timers.tick(50)
			await flush()
			step()
			assert.equal(bot.pathfinder.goal, goal, 'keep the same route')
		}
		assert.ok(
			bot.entity.position.x < before.x - 2,
			'actual displacement, not just an active goal'
		)
		assert.equal(bot.attacks.length, 0)
	})
}

for (const initialPartial of [false, true]) {
	test(`an active safe route survives distant threat movement, arrival and removal${initialPartial ? ' after a native partial result' : ''}`, t => {
		const { bot, actor } = createHarness(false, '1.20.6')
		const preferences = actor.getSnapshot().context.preferences
		const escape = new EscapeRuntime(bot.asBot(), preferences, Logger)
		t.after(() => {
			escape.stop()
			actor.stop()
		})
		const origin = bot.entity.position.clone()
		const nearby = threat(1, 18, 0)
		const paths: Array<Array<{ x: number; y: number; z: number }>> = []
		const statuses: PartiallyComputedPath['status'][] = []
		const contexts: unknown[] = []
		const getPath = bot.pathfinder.getPathFromTo.bind(bot.pathfinder)
		const now = performance.now.bind(performance)
		let slices = 0
		const search = t.mock.method(
			bot.pathfinder,
			'getPathFromTo',
			function* (...args: Parameters<typeof getPath>) {
				const generator = getPath(...args)
				while (true) {
					let next: ReturnType<typeof generator.next>
					if (initialPartial) {
						const first = slices++ === 0
						const base = now()
						let calls = 0
						const elapsed = preferences.escapeSearchSliceMs + 1
						// Exercise native AStar's slice boundary, not a fabricated partial result.
						// Carry that elapsed slice into later native calls without changing app clocks.
						const clock = t.mock.method(performance, 'now', () =>
							first ? base + (++calls <= 2 ? 0 : elapsed) : now() + elapsed
						)
						try {
							next = generator.next()
						} finally {
							clock.mock.restore()
						}
					} else next = generator.next()
					if (next.done) return next.value
					const result: PartiallyComputedPath = next.value.result
					statuses.push(result.status)
					contexts.push(next.value.astarContext)
					if (result.status === 'success') paths.push(result.path)
					yield next.value
				}
			}
		)
		const setGoal = t.mock.method(bot.pathfinder, 'setGoal')
		escape.move(nearby, [nearby, threat(2, 0, 45)], null)
		if (initialPartial) {
			assert.deepEqual(statuses, ['partial'])
			assert.equal(paths.length, 0)
			assert.equal(bot.pathfinder.goal, null)
			assert.equal(setGoal.mock.callCount(), 0)
		}
		// move advances one native slice. Its configured route deadline bounds completion.
		while (statuses.at(-1) === 'partial') {
			const before = statuses.length
			escape.move(nearby, [nearby, threat(2, 0, 45)], null)
			assert.equal(statuses.length, before + 1, 'pending search must advance')
			assert.equal(
				search.mock.callCount(),
				1,
				'continue the same native search'
			)
		}
		assert.equal(paths.length, 1)
		assert.ok(contexts.every(context => context === contexts[0]))
		const path = paths[0]
		assert.ok(path)
		const goal = bot.pathfinder.goal
		assert.ok(goal, 'successful safe search must activate the route')
		for (const threats of [
			[nearby, threat(2, 0, 48)],
			[nearby],
			[nearby, threat(3, 0, 49)]
		]) {
			assert.ok(
				new EscapeSafety(origin, threats, preferences).allowsPath(
					origin,
					path,
					true
				)
			)
			setGoal.mock.resetCalls()
			escape.move(nearby, threats, null)
			assert.equal(
				setGoal.mock.callCount(),
				0,
				'safe route must not be stopped or replaced'
			)
			assert.equal(bot.pathfinder.goal, goal)
		}
	})
}
