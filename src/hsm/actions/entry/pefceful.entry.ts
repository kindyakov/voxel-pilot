const entryIdle = ({ context, event }) => {
  console.log('🥱 Вход в состояние IDLE')
}

const entryMining = ({ context, event }) => {
  console.log('⛏️ Вход в состояние MINING')
}

const entryFarming = ({ context, event }) => {
  console.log('⚒️ Вход в состояние FARMING')
}

const entryBuilding = ({ context, event }) => {
  console.log('🧱 Вход в состояние BUILDING')
}

const entrySleeping = ({ context, event }) => {
  console.log('🛏️ Вход в состояние SLEEPING')
}

const entryFollowing = ({ context, event }) => {
  console.log('🚶‍♂️‍➡️ Вход в состояние FOLLOWING')
}

const entrySheltering = ({ context, event }) => {
  console.log('🏠 Вход в состояние SHELTERING')
}

export default {
  entryIdle,
  entryMining,
  entryFarming,
  entryBuilding,
  entrySleeping,
  entryFollowing,
  entrySheltering,
}