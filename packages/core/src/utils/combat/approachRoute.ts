import { Vec3 } from 'vec3'

type RoutePoint = { x: number; y: number; z: number }

/** Borrows native path suffixes read-only. Publication alone is not acceptance. */
export class AcceptedApproachRoute {
	private route: RoutePoint[] | null = null
	private length = 0
	private next: Vec3 | null = null
	private waypoint: Vec3 | null = null

	clear() {
		this.route = null
		this.length = 0
		this.next = null
		this.waypoint = null
	}

	publish(path: RoutePoint[]) {
		this.clear()
		this.route = path
		this.length = path.length
		const first = path[0]
		this.next = first ? new Vec3(first.x, first.y, first.z) : null
	}

	sample(position: Vec3): Vec3 | undefined {
		if (!this.route) return undefined
		if (this.route.length !== this.length) {
			// Native movement consumes one node per physics tick. If several nodes
			// disappeared between observations, their geometry cannot prove traversal.
			this.waypoint = this.length - this.route.length === 1 ? this.next : null
			this.length = this.route.length
			const first = this.route[0]
			this.next = first ? new Vec3(first.x, first.y, first.z) : null
		}
		// Native shift plus proximity proves traversal of the installed suffix.
		// A stationary shortened proposal, old path after reset, or off-route circle does not.
		return this.waypoint && position.distanceTo(this.waypoint) <= 1.25
			? this.waypoint.clone()
			: undefined
	}
}
