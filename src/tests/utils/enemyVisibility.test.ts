import assert from 'node:assert/strict'
import test from 'node:test'

import { Vec3 } from 'vec3'

import { canAttackEnemy, cleanupPathfindCache } from '../../utils/combat/enemyVisibility.js'

const createOpaqueBlock = () => ({
	boundingBox: 'block',
	transparent: false,
	material: 'rock',
	name: 'stone'
})

test('canAttackEnemy skips expensive pathfinding checks during active tasks when target is not visible', async () => {
	cleanupPathfindCache()

	let getPathFromToCalls = 0
	const bot = {
		entity: {
			position: new Vec3(0, 64, 0),
			height: 1.8
		},
		movements: {
			allowParkour: true,
			allowSprinting: true
		},
		blockAt: () => createOpaqueBlock(),
		pathfinder: {
			getPathFromTo: () => {
				getPathFromToCalls += 1
				return [
					{
						result: {
							status: 'success',
							path: [{ x: 0, y: 64, z: 0 }]
						}
					}
				][Symbol.iterator]()
			}
		}
	}

	const enemy = {
		id: 1,
		name: 'skeleton',
		height: 1.8,
		isValid: true,
		position: new Vec3(2, 64, 0)
	}

	const canAttack = await canAttackEnemy(
		bot as any,
		enemy as any,
		20,
		40,
		100,
		true
	)

	assert.equal(canAttack, false)
	assert.equal(getPathFromToCalls, 0)
})

