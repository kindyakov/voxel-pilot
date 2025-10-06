import pathFinderPkg from 'mineflayer-pathfinder';

const { goals } = pathFinderPkg;

/**
 * Идти к координатам X, Y, Z и остановиться рядом (радиус)
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} range — радиус, в котором цель считается достигнутой
 */
export const GoalNear = goals.GoalNear

/**
 * Следовать за Entity (игрок, моб, предмет) на заданной дистанции
 * @param {Entity} entity — объект игрока/моба
 * @param {number} range — дистанция для слежки
 */
export const GoalFollow = goals.GoalFollow

/**
 * Дойти прямо к блоку (встать на него)
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export const GoalBlock = goals.GoalBlock

/**
 * Дойти до позиции X, Z (игнорирует высоту Y)
 * @param {number} x
 * @param {number} z
 */
export const GoalXZ = goals.GoalXZ

/**
 * Дойти до конкретной высоты Y
 * @param {number} y
 */
export const GoalY = goals.GoalY

/**
 * Составная цель: достичь любую из переданных целей (OR)
 * @param {Goal[]} goalsList — массив целей
 */
export const GoalCompositeAny = goals.GoalCompositeAny

/**
 * Составная цель: достичь все цели по очереди (AND)
 * @param {Goal[]} goalsList — массив целей
 */
export const GoalCompositeAll = goals.GoalCompositeAll