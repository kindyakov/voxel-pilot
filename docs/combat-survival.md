# Combat and survival: behavior and verification

This is a public behavior overview and manual test checklist, not the agent architecture contract. Agent implementation guidance lives in `ARCHITECTURE.md`.

## Behavior

Critical health interrupts every active behavior except death/shutdown. The bot escapes using the nearest observed threat, eats only when safe, interrupts eating if danger closes, and stays in survival until health and safety are both restored. A goal received during survival is deferred; canceling the goal does not cancel survival. With no food, the bot reports the critical situation once per food-availability change and continues monitoring/escaping.

Once safe, the bot can wait for regeneration in the same distance band used to continue eating: it does not repeatedly stop/start around 30 blocks, and resumes escape at 20. A new meal or leaving survival still requires at least 30 blocks. Damage, invalid/stale observation or a failed recovery attempt invalidates permission to keep resting in the band.

Hunger without critical health permits eating only in safety; it does not cause flight or preempt fighting a nearby hostile. Danger or damage interrupts eating. After damage, actually leaving the eating place restores the possibility of eating thereabouts; restarting the actor does not. Hunger-only recovery can resume the goal when no food is available. It cannot release a critical-health episode.

Combat is self-defense, not distant hunting or PvP. An armed bot attacks the nearest eligible hostile within the self-defense boundary; equal distances use a stable entity-ID tie break. Uncertain aggression does not authorize an unprovoked attack or healthy flight. Tiny slimes are excluded; larger slimes are threats. Wither, dragon and warden are never attacked. These dangerous or uncertain mobs still matter to critical-health survival.

Confirmed death immediately removes a mob from targets and threats, even while its corpse remains in Mineflayer's entity registry. The next eligible opponent can replace it without restarting combat. Melee starts after equipment is ready without waiting for the periodic controller check; physics ticks track subsequent target changes. These are controller commands, not a guarantee of server-confirmed hits.

With a usable bow/crossbow and arrows, the bot can start firing at an eligible visible hostile up to 25 blocks away. This is a configured defense radius, not an estimate of that species' attack range. It applies to both new and continuing ranged targets. Without a ready ranged loadout, the existing melee admission/pursuit limits remain unchanged. The bot stands while firing rather than chasing or kiting. At 5 blocks it switches to an available melee weapon and closes the remaining distance; returning to ranged requires more than 6.5 blocks to avoid weapon oscillation.

Ranged control starts immediately after equipment completes and current target/range/visibility/ammunition are rechecked. Physics ticks stop firing when conditions cease to hold. Actors and guards use current positions for weapon switching, so an older scan distance cannot restart the bow instead of drawing the sword. Equipment cancellation and critical-health preemption still take priority.

Changing targets with the same bow preserves its draw. Stopping ranged combat cancels the draw instead of intentionally releasing an undercharged arrow. If a held sword breaks, attacks stop until a replacement is equipped; a spare sword in the inventory does not permit fist attacks. A bowl is not a ranged weapon.

Without a usable weapon (or ammunition for a ranged weapon), the bot does not enter combat and says so in chat once until rearmed. Weapon loss stops combat without flight. An exhausted approach or controller error stops the attack in `COMBAT.WAITING`, retaining the per-target retry budget. A mob entering actual melee reach can be hit without restarting exhausted pursuit; controller errors are not reset by proximity.

At normal health, tactical retreat is reserved for nearby swelling/ignited/unknown-state creepers. Retreat begins within 12 blocks and continues until those creepers are beyond 16 blocks or confirmed defused, even if an ordinary zombie is still nearby. The distance margin prevents repeated ranged/retreat switching around one boundary. A creeper disengagement is remembered throughout its observed encounter: ordinary updates and defusing do not restart melee, but this restriction must not mask other eligible targets. Suitable ranged combat remains possible afterward.

Escape never digs or places blocks. It measures displacement and progress, changes failed routes, reports exhaustion once, and waits for a relevant world/threat change while preserving the safety obligation. Changed approach conditions permit only a bounded number of retries. An absent path does not prove safety. Missing/stale observation does not permit eating or recovery completion. Damage during eating invalidates that location even if the source is unknown or distant; the obligation to relocate survives a failed route and actor retry.

Escape checks the route's segments against all known threats, not just its endpoint. Lateral detours are allowed; a completed waypoint must improve clearance. Failed observation restarts independently with a retry delay and cannot mark the area safe. A food attempt has a deadline covering equipment, consumption and restoration; expiration retries the attempt without releasing survival. If damage arrives while coordinates are invalid, relocation is planned only after valid observations return.

During movement, the remaining route is checked against current threats. Distant mob movement or disappearance does not cancel a still-safe route; a threat entering the remaining path does. The progress already made is retained instead of restarting the movement budget on every observation change.

## Current tuning

Implementation choices live in `src/hsm/context.ts`, not Minecraft constants:

| Setting | Default |
| --- | --- |
| Health entry / exit | below 10 / at least 18, plus safety |
| Hunger entry / restored | below 6 / at least 18 |
| Start eating / interrupt eating | at least 30 / at most 20 blocks |
| Melee-only preventive self-defense / existing encounter | 8 / 20 blocks |
| Ranged admission and firing limit, with weapon and arrows | at most 25 blocks |
| Switch to melee / return from melee to ranged | at most 5 / more than 6.5 blocks |
| Creeper danger boundary | 12 blocks, conservative for charged creepers |
| Creeper retreat completion | beyond 16 blocks, or confirmed defused |
| Observation radius / freshness and lost-threat retention | 50 blocks / 2 seconds |
| Escape waypoint length | 15 blocks; not the eating safety distance |
| Escape no-progress window / displacement | 1.5 seconds / 0.75 blocks |
| Alternative escape directions | 8 |
| Route search budget / per-tick slice | 200 / 10 ms |
| Failed recovery retry delay | 1 second |
| Approach no-progress window / failed routes | 3 seconds / 3 |
| Changed-condition approach retries | 2 per encounter |
| Meaningful threat displacement / approach memory after absence | 3 blocks / 30 seconds |

Distance alone is not protection against ranged attacks. Server AI, terrain, movement speed, visibility and latency can change outcomes. The bot does not promise to escape a physically closed trap or regenerate without usable food/server regeneration.

## Versioned evidence and limits

Metadata decoding uses named keys from the connected bot's `minecraft-data` registry, not fixed offsets or a single-version allowlist. Missing keys or malformed values remain unknown. Creeper swelling, powered and ignited are distinct signals. Automated registry/physics scenarios cover Java 1.20.1, 1.20.4 and 1.20.6; they do not certify every protocol/plugin feature or replace live server verification.

The basic Overworld spider policy uses Mineflayer's `bot.time.isDay` and light at the spider: block light at least 12, or daytime sky light at least 12, excludes an unprovoked spider. A dark cave remains dangerous during daytime; at night, bright block light still protects against a preventive attack. Missing time/light data remains uncertain when brightness cannot be established. This is an intentionally simplified policy, not a simulation of twilight, weather or custom server AI. Confirmed damage to this bot takes priority over the light rule. Enderman anger flags do not identify whom it targets; confirmed damage can authorize self-defense.

Confirmed aggression is remembered separately for each attacker for a bounded period: damage from a second mob does not erase the first one. Ordinary mobs use `category` from the connected bot's registry (`Hostile mobs` / `Passive mobs`), not a manual species whitelist or the representation `type`. For example, hoglins have type `animal` but a hostile category. An unprovoked wandering trader and its llamas do not trigger retreat or attack; confirmed damage from a llama still permits self-defense, subject to the critical-health priority. Missing or unknown categories remain uncertain.

A fresh observation confirming that a formerly uncertain mob is safe clears its old threat immediately. Last-position retention applies when a threat is no longer observed, not when visible metadata establishes safety.

Categories are only a baseline. A compact exception table preserves avoid-only bosses, passive undead horses, light-dependent spiders (including cave spiders), slime size, enderman/wolf/bee signals and rabbit variants. Unknown aggression conditions for piglins, polar bears, iron golems and goats remain uncertain; this baseline does not infer reputation, equipment-based acceptance or a mob's current target. Pufferfish also remain a potential danger despite their passive category: [approaching them can cause poison](https://www.minecraft.net/de-de/article/taking-inventory--pufferfish). The [killer rabbit variant](https://www.minecraft.net/en-us/article/who-framed-killer-rabbit) is not treated as an ordinary passive rabbit. These exceptions do not disable defense after confirmed damage.

Vanilla base follow-range attributes were checked in the [official 1.20.4 server artifact](https://piston-data.mojang.com/v1/objects/8dd1a28015f51b1803213892b50b7b4fc76e594d/server.jar) using the [matching official mappings](https://piston-data.mojang.com/v1/objects/c1cafe916dd8b58ed1fe0564fc8f786885224e62/server.txt): Mob defaults to 16; Zombie overrides to 35, Blaze to 48, Enderman to 64, Pillager to 32, Vindicator to 12. These are follow-range attributes, not universal detection or attack distances. The profile comments identify the exact artifact hashes; custom server modifiers are outside this baseline.

The same artifact separates creeper swelling/powered/ignited fields, gates slime damage by non-tiny size, and checks spider target acquisition against brightness. Mineflayer's normalized `entityHurt` supplies an optional source; absence is handled explicitly. Full target intent is not exposed reliably for every mob.

## Runtime diagnostics

Use `LOG_LEVEL=info` or `debug` to capture these messages:

- `[HSM] runtime`: configured Minecraft version, registry version, melee/ranged boundaries and active safety thresholds.
- `[HSM] transition`: full nested state paths, triggering event type, previous-state duration, nearest threat and movement owner.
- `[COMBAT] target_decision`: selected target, recognized weapons/ammunition and rejection reasons for up to five nearest candidates. Unchanged decisions with candidates repeat at most once every five seconds.
- `[COMBAT] waiting`: the attack is stopped, with the blocking reason and used retry count; it is not a flee decision.
- `[COMBAT] ranged_attack_issued` (debug): a firing controller was started for a target; this is not a per-arrow or hit-confirmation log.
- `[SURVIVAL] decision`: why the bot is escaping, eating or waiting, including missing food, stale observations and regeneration.
- `[SURVIVAL] route_search_started/route_search_finished`, `route_failed`, `movement_stalled` and `routes_exhausted`: distinguish route search, failed progress and exhausted alternatives.
- `[HSM] damage`: available damage-source facts; unknown sources remain null.
- `ENTITY_DIED` in transitions means confirmed death; `REMOVE_ENTITY` means disappearance, which can still leave a short-lived remembered threat. Death need not cause a state transition if combat continues against another mob.
- `[HSM] heartbeat`: every five seconds, current state and duration, last processed event, observation age, position and displacement since the previous sample. Displacement is the straight-line change in position, not traveled distance; zero alone does not prove a deadlock.

For an incident, retain logs from `[HSM] runtime` through the failure and at least two subsequent heartbeats. Transition/decision messages are emitted on change; diagnostics stop with the HSM. The new observer does not serialize event payloads, chat commands or full entities.

`[OBSERVATION] invalid` reports non-finite coordinates explicitly (for example `NaN`), with velocity and orientation for diagnosis. Such a scan is not fresh safety evidence: eating/attacking is stopped and known threats are retained. `[OBSERVATION] restored` marks a valid scan; recovery resumes automatically. Heartbeats include `positionValid` and `observationProblem`. This prevents false safety but does not invent replacement coordinates or repair an unknown upstream source of corrupt physics data.

## Manual Minecraft scenarios — not yet run for this change

Use disposable worlds on the configured Java version (repeat the compatibility scenarios on 1.20.1 and 1.20.6) and retain console logs plus video. Confirm actual position changes, not merely movement log messages.

1. Engage a zombie while armed, then drop below the health threshold. Confirm immediate cessation of attacks and real displacement away from the closest threat. Add a second closer mob behind the bot: the old route must not continue toward it.
2. Supply food, reach the eating boundary, then move the nearest threat through the hysteresis band and interruption boundary. Confirm food use stops at danger and resumes only after reaching the start boundary again.
3. While eating at range, take a skeleton/projectile hit. Confirm item use stops and the bot changes location before eating again. Repeat with unavailable damage-source data and an obstructed route.
4. Remove food during critical health, including during flight and inside a closed trap. Confirm one critical notice, no unsolicited return to combat/tasks, deferred replacement goals and goal-only cancellation. Supply food/open an exit and confirm recovery resumes.
5. Start an existing fight, then bring a different swelling creeper close. Repeat with a charged creeper. Confirm retreat, shield/item cleanup, and no automatic melee restart after the swelling clears. With bow/ammunition, check actual ranged shots at a suitable distance.
6. Test bright and dark spiders, unprovoked/angered endermen, tiny/larger slimes and each avoid-only boss. Confirm real entity types reach observation, players are not attacked, and remote detection alone does not trigger pursuit.
7. Block every exit, then open one side corridor. Confirm bounded route search, one stuck notice, no digging/placing, and actual escape after the world change. Repeat with side obstacles and water/uneven terrain.
8. Make a target unreachable or freeze effective progress. Confirm stopped movement and `COMBAT.WAITING` after the configured limit, not retreat; repeated observations and brief occlusion do not reset it. Change a relevant passage repeatedly and verify the retry budget is finite. Bring the mob into actual melee reach: defense should work without granting a new pursuit budget. A lost target returns control to the saved goal without resetting its execution budget.
9. Repeat health preemption during delayed equipment, aim, food use, navigation, block interaction and window operations. Confirm canceled callbacks never retake controls. Repeat with death and process shutdown.
10. In daylight, spawn an unprovoked spider on open, well-lit ground beside an armed bot: no retreat or attack. Repeat in a dark cave and at night, then with strong torchlight. Separately, provoke a spider until it damages the bot: confirmed damage must permit self-defense. Spawn a nearby zombie to verify ordinary defense on the configured version, then lower health below the recovery threshold and verify actual escape.
11. Disconnect during active combat or delayed initialization, then reconnect. Confirm the old session no longer attacks, moves, emits heartbeats or handles chat; the new HSM uses current health/food, not spawn defaults. Repeat shutdown while initialization is still pending: it must not start a bot afterward.
12. On Java 1.20.6, place an armed, healthy bot beside an unprovoked wandering trader and two trader llamas, with a skeleton about 38 blocks away. Confirm no retreat or pursuit. Bring a zombie within the self-defense boundary: the bot should defend against the zombie, not the llamas. At critical health, confirm a passive llama does not block food use, but the nearby zombie interrupts eating and causes actual escape. Separately, provoke a llama into damaging the bot and verify defense at normal health versus escape at critical health.

13. At full health, spawn two nearby zombies. Move the second closer and remove the first: the bot should attack the nearest eligible survivor, without fleeing. Remove its weapon: no punches or flight, one chat message. Supply a weapon and confirm combat resumes. Repeat with a bow without arrows and with each excluded boss.
14. Place a zombie beside a closer creeper. Trigger the creeper's fuse: the bot must disengage. Once the fuse clears, the zombie must remain attackable without an extra escape to the eating radius. Drop XP orbs nearby: they must never appear as threats or targets. Protocol-spawned XP orbs are covered in isolated tests on 1.20.1, 1.20.4 and 1.20.6.
15. Kill the current zombie while another remains nearby. Confirm the corpse is never selected again and the next zombie is attacked without an idle/re-equip cycle. Separately hide a living hostile: its last position should briefly remain a threat, unlike confirmed death.
16. After eating at critical health, let a pursuer move between 29 and 31 blocks. Confirm continuous regeneration waiting, then renewed escape at 20. Lower food below the restored threshold: a new meal must wait until 30. Move a distant mob during active escape and confirm the route is retained; move it onto the route and confirm a safe replacement with actual displacement.
17. Give a healthy bot a sword, bow and arrows. Bring a visible zombie from outside 25 blocks into the boundary: firing should start there, not at 8. Observe actual arrows while it approaches, then a single switch to sword at 5 and physical melee approach. Repeat with a skeleton. Remove arrows at 24 blocks: firing stops without a new sword pursuit. Repeat with a wall, a passive mob, an excluded boss and critical-health preemption during bow equip; none may bypass its existing restriction.

18. While the bow is drawn, change the selected hostile and confirm a normal full-strength shot; then interrupt with critical health or a close creeper and confirm no weak arrow is released by cancellation. Move the creeper repeatedly around 12 blocks: retreat should continue until the outer boundary is reached. Repeat after server slot/durability updates. Server plugins may veto slot changes used to cancel a draw, so verify this on the actual server.
19. Keep the only food stack outside the hotbar, interrupt its equip, and retry eating: food must remain in slots, not stranded on the cursor. Break the held sword while another sword is available: no fist hits while the replacement is equipping.

Automated counterparts use the public HSM, real Mineflayer plugins and Prismarine physics with a simulated server/world in `src/tests/hsm/*runtime.test.ts`. Protocol-adapter tests cover unknown/malformed versioned signals. These checks do not replace the live scenarios above.
