/** A missing or non-finite world position cannot establish distance or safety. */
export const isFinitePosition = (position: unknown): boolean =>
	typeof position === 'object' &&
	position !== null &&
	'x' in position &&
	Number.isFinite(position.x) &&
	'y' in position &&
	Number.isFinite(position.y) &&
	'z' in position &&
	Number.isFinite(position.z)
