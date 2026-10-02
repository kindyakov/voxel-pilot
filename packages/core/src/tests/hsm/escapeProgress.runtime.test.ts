import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import type { PartiallyComputedPath } from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

import { createHarness } from './fixtures/handoffBot.js'

/** Delay actual AStar slices, preserving its context, deadline and native result. */
const deferNativeSearch = (
	t: TestContext,
	bot: ReturnType<typeof createHarness>['bot'],
	stage: 'candidate' | 'movement'
) => {
	const getPath = bot.pathfinder.getPathFromTo.bind(bot.pathfinder)
	const now = performance.now.bind(performance)
	// These real partial slices leave the old 20-frame setup short of two blocks.
	const partialSlices = stage === 'candidate' ? 6 : 11
	const statuses: string[] = []
	const activeGoals: boolean[] = []
	let starts = 0
	t.mock.method(
		bot.pathfinder,
		'getPathFromTo',
		function* (...args: Parameters<typeof getPath>) {
			const candidate = args[3]?.tickTimeout !== undefined
			const selected = candidate === (stage === 'candidate')
			const delay = selected && starts++ === 0
			const generator = getPath(...args)
			if (!delay) return yield* generator
			const elapsed = (args[3]?.tickTimeout ?? bot.pathfinder.tickTimeout) + 1
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
			// Native movement resumes compute directly, while candidate search resumes the generator.
			t.mock.method(context, 'compute', () => {
				const result = compute<PartiallyComputedPath>(nativeCompute)
				statuses.push(result.status)
				activeGoals.push(Boolean(bot.pathfinder.goal))
				return result
			})
			yield first.value
			return yield* generator
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

for (const distance of [2, 6]) {
	for (const delayedStage of [null, 'candidate', 'movement'] as const) {
		test(`an active escape route is replaced when a threat moves ${distance} blocks behind the bot${delayedStage ? ` after native ${delayedStage} partials` : ''}`, async t => {
			t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
			const { bot, actor, enemy, observe, step } = createHarness()
			let readyPath = false
			const resetPath = () => {
				readyPath = false
			}
			const observePath = (result: PartiallyComputedPath) => {
				readyPath = result.status === 'success' && result.path.length > 0
			}
			bot.on('goal_updated', resetPath)
			bot.on('path_update', observePath)
			t.after(() => {
				bot.off('goal_updated', resetPath)
				bot.off('path_update', observePath)
				actor.stop()
			})
			const deferred = delayedStage
				? deferNativeSearch(t, bot, delayedStage)
				: null
			enemy.position = new Vec3(18, 64, 0)
			actor.send({ type: 'UPDATE_HEALTH', health: 8 })
			observe()
			await flush()
			// Search uses native wall time; mocked physics frames are not a readiness deadline.
			const deadline =
				performance.now() +
				actor.getSnapshot().context.preferences.escapeRouteTimeoutMs +
				bot.pathfinder.thinkTimeout
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
			const movementStart = bot.entity.position.x
			for (let i = 0; i < 20; i++) {
				t.mock.timers.tick(50)
				await flush()
				step()
			}
			const turnAt = bot.entity.position.x
			if (deferred) {
				assert.equal(deferred.starts, 1, 'continue the same native search')
				assert.deepEqual(
					deferred.statuses.slice(0, deferred.partialSlices),
					Array(deferred.partialSlices).fill('partial')
				)
				assert.equal(deferred.statuses.at(-1), 'success')
				if (delayedStage === 'candidate')
					assert.ok(deferred.activeGoals.every(value => !value))
				else assert.ok(deferred.activeGoals.every(value => value))
			}
			assert.ok(turnAt < -2)
			assert.ok(
				turnAt < movementStart - 2,
				'actual displacement during the original 20 physics frames'
			)
			enemy.position = bot.entity.position.offset(-distance, 0, 0)
			observe()
			for (let i = 0; i < 30; i++) {
				t.mock.timers.tick(50)
				await flush()
				step()
			}
			assert.ok(
				bot.entity.position.x > turnAt + 2,
				'must stop following the old route toward the new danger'
			)
		})
	}
}

test('a trapped survivor reports no exit once and moves again when a corridor opens', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe, step } = createHarness()
	t.after(() => actor.stop())
	let open = false
	bot.solidAt = p =>
		p.y < 64 ||
		(p.y < 69 &&
			(Math.abs(Math.floor(p.x)) >= 2 || Math.abs(Math.floor(p.z)) >= 2) &&
			!(open && p.x < -1 && Math.abs(p.z) < 2))
	enemy.position = new Vec3(1, 64, 0)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	observe()
	await flush()
	for (let i = 0; i < 160; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.equal(
		bot.chatMessages.filter(message => /выход|застрял/i.test(message)).length,
		1
	)
	assert.equal(bot.attacks.length, 0)
	assert.equal(bot.digCalls.length, 0)
	assert.equal(bot.placeCalls.length, 0)
	open = true
	bot.emit('blockUpdate', null, bot.blockAt(new Vec3(-2, 64, 0)))
	for (let i = 0; i < 100; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(bot.entity.position.x < -4)
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
})
