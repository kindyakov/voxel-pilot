import { Vec3 } from 'vec3'

type RoutePoint = { x: number; y: number; z: number }

/** Borrows native path suffixes read-only. Publication alone is not acceptance. */
export class AcceptedApproachRoute {
	private route: RoutePoint[] | null = null
	private original: RoutePoint[] = []
	private consumed = 0
	private waypoint: Vec3 | null = null

	clear() {
		this.route = null
		this.original = []
		this.consumed = 0
		this.waypoint = null
	}

	publish(path: RoutePoint[]) {
		this.clear()
		// Bound borrowed geometry; ordinary direct-distance progress remains available.
		if (path.length > 8192) return
		this.route = path
		this.original = path.map(({ x, y, z }) => ({ x, y, z }))
	}

	sample(position: Vec3): Vec3 | undefined {
		if (!this.route) return undefined
		const consumed = this.original.length - this.route.length
		if (consumed > this.consumed) {
			const node = this.original[consumed - 1]
			this.consumed = consumed
			if (node) this.waypoint = new Vec3(node.x, node.y, node.z)
		}
		// Native shift plus proximity proves traversal of the installed suffix.
		// A stationary shortened proposal, old path after reset, or off-route circle does not.
		return this.waypoint && position.distanceTo(this.waypoint) <= 1.25
			? this.waypoint.clone()
			: undefined
	}
}
