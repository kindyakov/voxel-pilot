import pathFinderPkg from 'mineflayer-pathfinder'
import type { goals } from 'mineflayer-pathfinder'
import type { Entity } from 'prismarine-entity'

const { goals: goalsClasses } = pathFinderPkg

/**
 * Идти к координатам X, Y, Z и остановиться рядом (радиус)
 */
export class GoalNear extends goalsClasses.GoalNear {
	constructor(x: number, y: number, z: number, range: number) {
		super(x, y, z, range)
	}
}

/**
 * Следовать за Entity (игрок, моб, предмет) на заданной дистанции
 */
export class GoalFollow extends goalsClasses.GoalFollow {
	constructor(entity: Entity, range: number) {
		super(entity, range)
	}
}

/**
 * Дойти прямо к блоку (встать на него)
 */
export class GoalBlock extends goalsClasses.GoalBlock {
	constructor(x: number, y: number, z: number) {
		super(x, y, z)
	}
}

/**
 * Дойти до позиции X, Z (игнорирует высоту Y)
 */
export class GoalXZ extends goalsClasses.GoalXZ {
	constructor(x: number, z: number) {
		super(x, z)
	}
}

/**
 * Дойти до конкретной высоты Y
 */
export class GoalY extends goalsClasses.GoalY {
	constructor(y: number) {
		super(y)
	}
}

/**
 * Составная цель: достичь любую из переданных целей (OR)
 */
export class GoalCompositeAny extends goalsClasses.GoalCompositeAny<goals.Goal> {
	constructor(goalsList: goals.Goal[]) {
		super(goalsList)
	}
}

/**
 * Составная цель: достичь все цели по очереди (AND)
 */
export class GoalCompositeAll extends goalsClasses.GoalCompositeAll<goals.Goal> {
	constructor(goalsList: goals.Goal[]) {
		super(goalsList)
	}
}
