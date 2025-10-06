const entryCombat = ({ context: { bot } }) => {
  console.log('⚔️ Вход в состояние COMBAT')

  bot.armorManager.equipAll() // Бот при наличии брони в инвенторе наденет её

  if (bot.movements) {
    bot.movements.allowSprinting = true // Разрешаем боту бежать        
  }
}

const entryDeciding = ({ context }) => {
  console.log('🤔⚔️ Вход в состояние DECIDING')
}

const entryFleeing = ({ context, event }) => {
  console.log('🏃 Вход в состояние FLEEING')
}

const entryDefenging = ({ context, event }) => {
  console.log('⚔️ Вход в состояние DEFENDING')
}

const entryMeleeAttacking = ({ context: { bot, nearestEnemy }, event }) => {
  console.log('⚔️ Вход в состояние MELEE_ATTACKING')
}

const entryRangedAttacking = ({ context: { bot, nearestEnemy }, event }) => {
  console.log('⚔️ Вход в состояние RANGED_ATTACKING')
}

export default {
  entryCombat,
  entryDeciding,
  entryFleeing,
  entryDefenging,
  entryMeleeAttacking,
  entryRangedAttacking,
}