export const executionSignature = (
	toolName: string,
	args: Record<string, unknown>
) => `${toolName}:${JSON.stringify(args)}`
