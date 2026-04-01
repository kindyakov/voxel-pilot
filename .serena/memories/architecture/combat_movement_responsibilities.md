# Combat movement responsibilities

Use `mineflayer-pathfinder` for macro movement: route planning, long-distance navigation, path computation from point A to B, long chase/flee/follow, and reachability checks.

Use `mineflayer-movement` for micro movement when combat needs short-horizon, reactive control: quick repositioning, responsive jumps, short evasive movement, and fine combat steering.

Do not treat `mineflayer-movement` as a replacement for `mineflayer-pathfinder`, and do not treat `mineflayer-pathfinder` as the ideal tool for highly reactive combat micro-control. They solve different layers of movement.

Rule of thumb:
- `pathfinder` owns macro navigation and long-route intent.
- `movement` owns micro control only when a dedicated combat movement controller explicitly takes ownership.
- Avoid simultaneous ownership of movement by both systems. Any switch between them must be explicit and state-driven.