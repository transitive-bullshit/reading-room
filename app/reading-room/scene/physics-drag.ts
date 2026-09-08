import { PHYSICS_STEP, type BookBody } from './physics-world'

export interface DragPoint {
  x: number
  y: number
  z: number
}

export interface DragTarget {
  position: DragPoint
  velocity: DragPoint
  lastInputTime: number
}

const FREQUENCY = 40
const POSITION_GAIN = FREQUENCY ** 2
const VELOCITY_GAIN = FREQUENCY * 2
// Enough braking for an 8-unit/s reversal within 50ms, with finite contact force.
const MAX_ACCELERATION = 550

export function createDragTarget(
  position: DragPoint,
  timeSeconds: number
): DragTarget {
  return {
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    lastInputTime: timeSeconds
  }
}

export function updateDragTarget(
  target: DragTarget,
  position: DragPoint,
  timeSeconds: number
) {
  const elapsed = timeSeconds - target.lastInputTime
  if (elapsed > 0.001 && elapsed < 0.12) {
    const blend = 1 - Math.exp(-elapsed / 0.008)
    const nextVelocity = {
      x: (position.x - target.position.x) / elapsed,
      y: (position.y - target.position.y) / elapsed,
      z: (position.z - target.position.z) / elapsed
    }
    const scale = Math.min(
      1,
      20 /
        Math.max(
          0.001,
          Math.hypot(nextVelocity.x, nextVelocity.y, nextVelocity.z)
        )
    )
    target.velocity.x += (nextVelocity.x * scale - target.velocity.x) * blend
    target.velocity.y += (nextVelocity.y * scale - target.velocity.y) * blend
    target.velocity.z += (nextVelocity.z * scale - target.velocity.z) * blend
  } else if (elapsed >= 0.12) {
    target.velocity = { x: 0, y: 0, z: 0 }
  }
  target.position = { ...position }
  target.lastInputTime = timeSeconds
}

// A damped physical pull with pointer-velocity feed-forward. Run after clearing
// previous forces; releasing only needs to clear this force, preserving momentum.
export function applyBookDrag(
  body: BookBody,
  target: DragTarget,
  timeSeconds: number,
  deltaSeconds = PHYSICS_STEP
) {
  if (!body.isDynamic()) return
  const point = body.translation()
  const velocity = body.linvel()
  const mass = body.mass()
  const inputAge = Math.max(0, timeSeconds - target.lastInputTime)
  // One physics step of grace covers the next input sample. Stale velocity then
  // decays in milliseconds so a stationary pointer does not keep pulling ahead.
  const follow = Math.exp(-Math.max(0, inputAge - deltaSeconds) / 0.01)
  const force = {
    x:
      (target.position.x - point.x) * POSITION_GAIN +
      (target.velocity.x * follow - velocity.x) * VELOCITY_GAIN,
    y:
      (target.position.y - point.y) * POSITION_GAIN +
      (target.velocity.y * follow - velocity.y) * VELOCITY_GAIN +
      9.81,
    z:
      (target.position.z - point.z) * POSITION_GAIN +
      (target.velocity.z * follow - velocity.z) * VELOCITY_GAIN
  }
  const scale =
    mass *
    Math.min(
      1,
      MAX_ACCELERATION / Math.max(0.001, Math.hypot(force.x, force.y, force.z))
    )
  body.addForce(
    { x: force.x * scale, y: force.y * scale, z: force.z * scale },
    true
  )
}
