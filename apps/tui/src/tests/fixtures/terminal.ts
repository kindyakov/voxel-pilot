import { Socket } from 'node:net'
import { stripVTControlCharacters } from 'node:util'

export class Input extends Socket {
	isTTY = true
	isRaw = false
	readonly rawCalls: boolean[] = []
	failRaw = false
	private enabled!: () => void
	readonly rawEnabled = new Promise<void>(resolve => {
		this.enabled = resolve
	})
	constructor() {
		super({ readable: true, writable: false })
	}
	override _read() {}
	setRawMode(mode: boolean): this {
		this.rawCalls.push(mode)
		this.isRaw = mode
		if (mode && this.failRaw) throw new Error('raw input fixture failure')
		if (mode) this.enabled()
		return this
	}
	send(input: string) {
		this.push(input)
	}
}

export class Output extends Socket {
	isTTY = true
	columns = 100
	rows = 24
	hold = false
	failWrite = false
	readonly chunks: string[] = []
	readonly acknowledged: string[] = []
	private callbacks: (() => void)[] = []
	constructor() {
		super({ readable: false, writable: true })
	}
	override _write(
		chunk: Buffer,
		_encoding: BufferEncoding,
		callback: (error?: Error | null) => void
	) {
		this.chunks.push(chunk.toString())
		const finish = () => {
			this.acknowledged.push(chunk.toString())
			callback()
		}
		if (this.failWrite) {
			this.failWrite = false
			callback(new Error('output fixture failure'))
		} else if (this.hold) this.callbacks.push(finish)
		else queueMicrotask(finish)
	}
	override _writev(
		chunks: { chunk: Buffer | string; encoding: BufferEncoding }[],
		callback: (error?: Error | null) => void
	) {
		this._write(
			Buffer.from(chunks.map(value => value.chunk.toString()).join('')),
			'utf8',
			callback
		)
	}
	release() {
		this.hold = false
		for (const callback of this.callbacks.splice(0)) callback()
	}
	resize(columns: number, rows: number) {
		this.columns = columns
		this.rows = rows
		this.emit('resize')
	}
	text() {
		return stripVTControlCharacters(this.chunks.join(''))
	}
	clearLine(_direction: -1 | 0 | 1, callback?: () => void) {
		callback?.()
		return true
	}
	clearScreenDown(callback?: () => void) {
		callback?.()
		return true
	}
	cursorTo(_x: number, y?: number | (() => void), callback?: () => void) {
		if (typeof y === 'function') y()
		callback?.()
		return true
	}
	moveCursor(_x: number, _y: number, callback?: () => void) {
		callback?.()
		return true
	}
	getColorDepth() {
		return 1
	}
	hasColors(_count?: number | object, _environment?: object) {
		return false
	}
	getWindowSize(): [number, number] {
		return [this.columns, this.rows]
	}
}
