import type { BookBody } from './physics-world'

export interface HeldBookRotation {
  x: number
  y: number
  z: number
  w: number
}

const FREQUENCY = 10
const MAX_ANGULAR_ACCELERATION = 50
const MAX_TORQUE_PER_MASS = 20

/** Apply only while held, after resetting torques. The target stays fixed per grab. */
export function applyHeldBookTorque(body: BookBody, target: HeldBookRotation) {
  if (!body.isDynamic()) return
  const current = body.rotation()
  // target * inverse(current) expresses the shortest correction in world space.
  let x =
    -target.w * current.x +
    target.x * current.w -
    target.y * current.z +
    target.z * current.y
  let y =
    -target.w * current.y +
    target.x * current.z +
    target.y * current.w -
    target.z * current.x
  let z =
    -target.w * current.z -
    target.x * current.y +
    target.y * current.x +
    target.z * current.w
  let w =
    target.w * current.w +
    target.x * current.x +
    target.y * current.y +
    target.z * current.z
  if (w < 0) {
    x = -x
    y = -y
    z = -z
    w = -w
  }
  const sine = Math.hypot(x, y, z)
  const angle = 2 * Math.atan2(sine, Math.max(0, w))
  const errorScale = sine > 1e-7 ? angle / sine : 2
  const angular = body.angvel()
  const damping = Math.max(0, FREQUENCY * 2 - body.angularDamping())
  x = x * errorScale * FREQUENCY ** 2 - angular.x * damping
  y = y * errorScale * FREQUENCY ** 2 - angular.y * damping
  z = z * errorScale * FREQUENCY ** 2 - angular.z * damping
  const accelerationScale = Math.min(
    1,
    MAX_ANGULAR_ACCELERATION / Math.max(1e-7, Math.hypot(x, y, z))
  )
  x *= accelerationScale
  y *= accelerationScale
  z *= accelerationScale

  // Using the actual inertia gives a thick hardcover and a thin book comparable
  // settling times while keeping the solver in charge of collision deflection.
  const inertia = body.effectiveAngularInertia()
  const torque = {
    x: inertia.m11 * x + inertia.m12 * y + inertia.m13 * z,
    y: inertia.m21 * x + inertia.m22 * y + inertia.m23 * z,
    z: inertia.m31 * x + inertia.m32 * y + inertia.m33 * z
  }
  const limit = body.mass() * MAX_TORQUE_PER_MASS
  const torqueScale = Math.min(
    1,
    limit / Math.max(1e-7, Math.hypot(torque.x, torque.y, torque.z))
  )
  body.addTorque(
    {
      x: torque.x * torqueScale,
      y: torque.y * torqueScale,
      z: torque.z * torqueScale
    },
    true
  )
}
