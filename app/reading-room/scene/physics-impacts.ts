import type RAPIER from '@dimforge/rapier3d-compat'

import type { BookImpact } from '../room-audio'
import type { BookBody, Physics } from './physics-world'

interface Motion {
  position: RAPIER.Vector
  linear: RAPIER.Vector
  angular: RAPIER.Vector
}

function speedAt(motion: Motion | undefined, point: RAPIER.Vector) {
  if (!motion) return { x: 0, y: 0, z: 0 }
  const x = point.x - motion.position.x
  const y = point.y - motion.position.y
  const z = point.z - motion.position.z
  return {
    x: motion.linear.x + motion.angular.y * z - motion.angular.z * y,
    y: motion.linear.y + motion.angular.z * x - motion.angular.x * z,
    z: motion.linear.z + motion.angular.x * y - motion.angular.y * x
  }
}

// Listen to solved contacts, retaining pre-step velocities so a landing still
// has its incoming speed after the solver has brought the book to rest.
export function createBookImpacts(physics: Physics, world: RAPIER.World) {
  const queue = new physics.EventQueue(true)
  const motion = new Map<number, Motion>()
  const candidates = new Map<string, BookImpact>()
  const lastPlayed = new Map<string, number>()
  let lastBurst = -Infinity

  return {
    queue,
    track(body: BookBody) {
      body
        .collider(0)
        .setActiveEvents(physics.ActiveEvents.CONTACT_FORCE_EVENTS)
      body.collider(0).setContactForceEventThreshold(8)
    },
    beforeStep() {
      motion.clear()
      world.forEachRigidBody((body) => {
        if (!body.isEnabled() || body.isFixed() || body.isSleeping()) return
        motion.set(body.handle, {
          position: body.translation(),
          linear: body.linvel(),
          angular: body.angvel()
        })
      })
    },
    afterStep() {
      queue.drainContactForceEvents((event) => {
        const first = world.getCollider(event.collider1())
        const second = world.getCollider(event.collider2())
        const a = first?.parent()
        const b = second?.parent()
        if (!a || !b) return
        if (!motion.has(a.handle) && !motion.has(b.handle)) return
        const impulse = event.totalForceMagnitude() * world.timestep
        if (impulse < 0.055) return
        let normalSpeed = 0
        let contactX = (a.translation().x + b.translation().x) / 2
        world.contactPair(first, second, (manifold) => {
          const normal = manifold.normal()
          for (let i = 0; i < manifold.numSolverContacts(); i++) {
            const point = manifold.solverContactPoint(i)
            if (!point) continue
            const va = speedAt(motion.get(a.handle), point)
            const vb = speedAt(motion.get(b.handle), point)
            const speed = Math.abs(
              (va.x - vb.x) * normal.x +
                (va.y - vb.y) * normal.y +
                (va.z - vb.z) * normal.z
            )
            if (speed > normalSpeed) {
              normalSpeed = speed
              contactX = point.x
            }
          }
        })
        // Weight at rest and sliding friction are not new book impacts.
        if (normalSpeed < 0.24) return
        const table = a.isFixed() || b.isFixed()
        const mass = table
          ? (a.isFixed() ? b : a).mass()
          : (a.mass() * b.mass()) / (a.mass() + b.mass())
        const strength = Math.min(
          1,
          0.08 + Math.sqrt(Math.min(impulse, normalSpeed * mass) / 6) * 0.72
        )
        const key = [first.handle, second.handle]
          .sort((x, y) => x - y)
          .join(':')
        if ((candidates.get(key)?.strength ?? 0) < strength)
          candidates.set(key, {
            kind: table ? 'table' : 'book',
            strength,
            pan: Math.max(-0.85, Math.min(0.85, contactX / 5))
          })
      })
    },
    flush(now: number, play: (impact: BookImpact) => void) {
      if (now - lastBurst >= 45) {
        const audible = [...candidates]
          .filter(([key]) => now - (lastPlayed.get(key) ?? -Infinity) >= 150)
          .sort((a, b) => b[1].strength - a[1].strength)
          .slice(0, 2)
        for (const [key, impact] of audible) {
          play(impact)
          lastPlayed.set(key, now)
          lastBurst = now
        }
      }
      candidates.clear()
      for (const [key, time] of lastPlayed)
        if (now - time > 2000) lastPlayed.delete(key)
    },
    dispose() {
      queue.free()
      motion.clear()
      candidates.clear()
      lastPlayed.clear()
    }
  }
}
