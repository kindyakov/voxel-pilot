import type { ActionParams } from '../../types'

const entryEmergencyEating = ({ context, event }) => {
  console.log('🚨 Вход в EMERGENCY_EATING 🥩')
}

const entryEmergencyHealing = ({ context, event }) => {
  console.log('🚨 Вход в EMERGENCY_HEALING 💗')
}

export default {
  entryEmergencyEating,
  entryEmergencyHealing,
}