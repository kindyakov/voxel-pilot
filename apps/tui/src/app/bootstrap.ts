import {
	type ApplicationRuntimeOptions,
	createApplicationRuntime
} from '@voxel-pilot/application'

export type TuiRuntimeOptions = Omit<
	ApplicationRuntimeOptions,
	'mode' | 'output'
> & {
	readonly output?: Partial<NonNullable<ApplicationRuntimeOptions['output']>>
}

/** Called after terminal preflight; safe preview supplies its own public runtime. */
export function createTuiRuntime(options: TuiRuntimeOptions = {}) {
	const { output, ...runtimeOptions } = options
	return createApplicationRuntime({
		...runtimeOptions,
		mode: 'tui',
		output:
			output?.files === undefined
				? undefined
				: { console: false, files: output.files }
	})
}
