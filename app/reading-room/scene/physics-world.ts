import type RAPIER from '@dimforge/rapier3d-compat'

export type Physics = typeof RAPIER
export type BookBody = RAPIER.RigidBody
export const PHYSICS_STEP = 1 / 120
export const TABLE_WIDTH = 10
export const TABLE_DEPTH = 6.365

let physicsPromise: Promise<Physics> | undefined

export function loadPhysics() {
  physicsPromise ??= import('@dimforge/rapier3d-compat').then(
    async (module) => {
      await module.default.init()
      return module.default
    }
  )
  return physicsPromise
}

export function makeWorld(physics: Physics) {
  const world = new physics.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = PHYSICS_STEP
  world.numSolverIterations = 10
  const table = world.createRigidBody(physics.RigidBodyDesc.fixed())
  world.createCollider(
    physics.ColliderDesc.cuboid(TABLE_WIDTH / 2, 0.2, TABLE_DEPTH / 2)
      .setTranslation(0, -0.2, 0)
      .setFriction(0.7)
      .setRestitution(0),
    table
  )
  return world
}

export interface BookDimensions {
  width: number
  depth: number
  height: number
  mass: number
}

export function bookDimensions(aspect: number, pages: number): BookDimensions {
  const depth = 1.92
  return {
    width: depth * aspect,
    depth,
    height: 0.085 + Math.min(1200, pages) * 0.00017,
    mass: 0.48 + Math.min(1200, pages) * 0.00115
  }
}

export function makeBookBody(
  physics: Physics,
  world: RAPIER.World,
  dimensions: BookDimensions,
  position: RAPIER.Vector,
  yaw = 0
) {
  const body = world.createRigidBody(
    physics.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setLinearDamping(0.65)
      .setAngularDamping(2.5)
      .setCcdEnabled(true)
      .setAdditionalSolverIterations(4)
  )
  const radius = 0.012
  world.createCollider(
    physics.ColliderDesc.roundCuboid(
      dimensions.width / 2 - radius,
      dimensions.height / 2 - radius,
      dimensions.depth / 2 - radius,
      radius
    )
      .setMass(dimensions.mass)
      .setFriction(0.62)
      .setRestitution(0.015)
      .setContactSkin(0.001),
    body
  )
  return body
}

/** The same soft table boundary is used by live and saved-pile physics. */
export function applyPileBounds(
  body: BookBody,
  dimensions: BookDimensions,
  limitX: number,
  limitZ = 2.13
) {
  const point = body.translation()
  const velocity = body.linvel()
  const excessX = Math.max(0, Math.abs(point.x) - limitX)
  const excessZ = Math.max(0, Math.abs(point.z) - limitZ)
  if (excessX || excessZ)
    body.addForce(
      {
        x: excessX
          ? (-Math.sign(point.x) * excessX * 24 - velocity.x * 4) *
            dimensions.mass
          : 0,
        y: 0,
        z: excessZ
          ? (-Math.sign(point.z) * excessZ * 24 - velocity.z * 4) *
            dimensions.mass
          : 0
      },
      true
    )
}

// A small spring torque favors a readable cover while preserving contact motion.
// No rotation is assigned here: gravity, inertia and the solver still decide the pose.
export function applyCoverUpTorque(body: BookBody, mass: number) {
  if (!body.isDynamic()) return
  const q = body.rotation()
  const up = {
    x: 2 * (q.x * q.y - q.z * q.w),
    y: 1 - 2 * (q.x * q.x + q.z * q.z),
    z: 2 * (q.y * q.z + q.x * q.w)
  }
  const horizontal = Math.hypot(up.x, up.z)
  const tilt = Math.atan2(horizontal, up.y)
  if (tilt < 0.025) return
  if (body.isSleeping()) {
    if (up.y > 0) return
    body.wakeUp()
  }
  const angular = body.angvel()
  const strength = Math.min(0.52, tilt * 0.95) * mass
  const denominator = Math.max(horizontal, 0.001)
  body.addTorque(
    {
      x:
        (horizontal < 0.001 ? 1 : -up.z / denominator) * strength -
        angular.x * 0.07 * mass,
      y: 0,
      z: (up.x / denominator) * strength - angular.z * 0.07 * mass
    },
    false
  )
}
