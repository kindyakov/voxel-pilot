import { fromCallback } from "xstate"

const serviceEntitiesTracking = fromCallback(({ sendBack }) => {
  const interval = setInterval(() => {
    sendBack({ type: 'UPDATE_ENTITIES' })
  }, 100)

  return () => clearInterval(interval)
})

export default {
  serviceEntitiesTracking,
}