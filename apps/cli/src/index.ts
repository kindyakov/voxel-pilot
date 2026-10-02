import { startCliApplication } from './application.js'
import { createCliRuntime } from './bootstrap.js'

const { runtime, loggerHandle } = createCliRuntime()
startCliApplication({
	runtime,
	loggerHandle,
	signals: process,
	exit: code => process.exit(code),
	report: message => console.error(message)
})
