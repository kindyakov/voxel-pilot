import { startTuiApplication } from './app/application.js'

try {
	const application = startTuiApplication()
	const result = await application.done
	process.exit(result.exitCode)
} catch {
	console.error(
		'TUI requires a supported interactive terminal and valid configuration. Run pnpm start for the headless CLI.'
	)
	process.exit(1)
}
