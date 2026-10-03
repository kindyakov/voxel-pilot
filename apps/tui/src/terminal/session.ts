import { type Instance, render } from 'ink'
import type { ReactNode } from 'react'

import type { TerminalStreams } from './preflight.js'

/** Owns Ink and terminal state; gameplay cleanup belongs to the app runtime. */
export function createTerminalSession(
	streams: TerminalStreams,
	onFatal: () => void
) {
	const initialRaw = streams.stdin.isRaw
	let instance: Instance | undefined
	let exited: Promise<unknown> | undefined
	let disposed = false
	let closing: Promise<void> | undefined
	let cleanupFailed = false
	const onError = () => {
		if (!disposed) onFatal()
	}
	// Ink queues raw teardown after unmount; keep that narrow native port isolated too.
	const setRawMode = (mode: boolean) => {
		try {
			return streams.stdin.setRawMode(mode)
		} catch {
			cleanupFailed = true
			queueMicrotask(onError)
			return streams.stdin
		}
	}
	const input = new Proxy(streams.stdin, {
		get(target, key, receiver) {
			return key === 'setRawMode'
				? setRawMode
				: Reflect.get(target, key, receiver)
		}
	})
	const release = () => {
		streams.stdout.off('error', onError)
		streams.stderr.off('error', onError)
	}
	return {
		mount(node: ReactNode) {
			streams.stdout.on('error', onError)
			streams.stderr.on('error', onError)
			// Register exit observation before user components/effects can fail during mounting.
			instance = render(null, {
				...streams,
				stdin: input,
				exitOnCtrlC: false,
				patchConsole: false,
				interactive: true,
				alternateScreen: true
			})
			exited = instance.waitUntilExit()
			void exited.then(() => {
				if (!disposed) onFatal()
			}, onError)
			instance.rerender(node)
		},
		async flush() {
			await instance?.waitUntilRenderFlush()
		},
		dispose() {
			if (closing) return closing
			disposed = true
			try {
				instance?.cleanup()
			} catch {
				cleanupFailed = true
			}
			try {
				if (streams.stdin.isRaw !== initialRaw)
					streams.stdin.setRawMode(initialRaw)
			} catch {
				cleanupFailed = true
			}
			const restored = new Promise<void>((resolve, reject) => {
				try {
					streams.stdout.write('\u001b[?1049l\u001b[?25h', error =>
						error ? reject(error) : resolve()
					)
				} catch (error) {
					reject(error)
				}
			})
			closing = Promise.all([exited, restored])
				.then(() => {
					if (cleanupFailed) throw new Error('Terminal cleanup failed')
				})
				.finally(release)
			return closing
		},
		release
	}
}
