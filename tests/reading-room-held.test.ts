import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Euler, Quaternion, Vector3 } from 'three'

import { makeCamera } from '../app/reading-room/scene/physics-camera'
import {
  applyBookDrag,
  createDragTarget
} from '../app/reading-room/scene/physics-drag'
import {
  applyHeldBookTorque,
  type HeldBookRotation
} from '../app/reading-room/scene/physics-held'
import {
  bookDimensions,
  loadPhysics,
  makeBookBody,
  makeWorld,
  PHYSICS_STEP
} from '../app/reading-room/scene/physics-world'

function cameraTarget(rollDegrees: number) {
  return makeCamera()
    .quaternion.clone()
    .multiply(
      new Quaternion().setFromAxisAngle(
        new Vector3(0, 0, 1),
        (rollDegrees * Math.PI) / 180
      )
    )
    .multiply(
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
    )
}

function angleBetween(first: HeldBookRotation, second: HeldBookRotation) {
  const dot = Math.abs(
    first.x * second.x +
      first.y * second.y +
      first.z * second.z +
      first.w * second.w
  )
  return 2 * Math.acos(Math.min(1, dot))
}

for (const { name, orientation, roll, pages } of [
  {
    name: 'face-down',
    orientation: new Euler(Math.PI, 0, 0),
    roll: -15,
    pages: 350
  },
  {
    name: 'backward',
    orientation: new Euler(0.2, Math.PI, 0),
    roll: 15,
    pages: 1000
  },
  {
    name: 'inverted and twisted',
    orientation: new Euler(2.8, 2.4, -1.1),
    roll: 12,
    pages: 700
  }
]) {
  await test(`held ${name} book turns toward the camera and preserves its chosen roll`, async (t) => {
    const physics = await loadPhysics()
    const world = makeWorld(physics)
    t.after(() => world.free())
    const dimensions = bookDimensions(0.66, pages)
    const holdPoint = { x: 0, y: 1.3, z: 0 }
    const body = makeBookBody(physics, world, dimensions, holdPoint)
    body.setRotation(new Quaternion().setFromEuler(orientation), true)
    const target = cameraTarget(roll)
    const dragTarget = createDragTarget(holdPoint, 0)
    const originalRotation = { ...body.rotation() }
    const originalPosition = { ...body.translation() }
    const assignRotation = t.mock.method(body, 'setRotation')
    const assignNextRotation = t.mock.method(body, 'setNextKinematicRotation')
    const assignAngularVelocity = t.mock.method(body, 'setAngvel')
    const assignType = t.mock.method(body, 'setBodyType')

    applyHeldBookTorque(body, target)
    assert.deepEqual(
      { ...body.rotation() },
      originalRotation,
      'a torque request must not assign a new pose'
    )
    assert.deepEqual({ ...body.translation() }, originalPosition)
    assert.ok(
      Math.hypot(...Object.values(body.userTorque())) <= body.mass() * 20.001
    )

    let reachedAt = Infinity
    let biggestStep = 0
    let previousRotation = originalRotation
    for (let step = 1; step <= 108; step++) {
      const time = step * PHYSICS_STEP
      body.resetForces(false)
      body.resetTorques(false)
      applyBookDrag(body, dragTarget, time)
      applyHeldBookTorque(body, target)
      world.step()
      const current = { ...body.rotation() }
      biggestStep = Math.max(
        biggestStep,
        angleBetween(previousRotation, current)
      )
      previousRotation = current
      if (angleBetween(current, target) < (5 * Math.PI) / 180)
        reachedAt = Math.min(reachedAt, time)
    }
    t.diagnostic(
      `Reached a 5° camera/roll tolerance in ${Math.round(reachedAt * 1000)}ms`
    )
    assert.ok(
      reachedAt >= 0.2 && reachedAt <= 0.9,
      'the turn should be continuous and settle within the held interaction'
    )
    assert.ok(
      angleBetween(body.rotation(), target) < (5 * Math.PI) / 180,
      'the full camera-facing orientation, including the selected roll, should settle'
    )
    assert.ok(
      biggestStep < 0.1,
      'no simulation step should snap a book into its target orientation'
    )
    assert.ok(
      Math.abs(body.translation().y - holdPoint.y) < 0.04,
      'drag support should keep the center near the held height'
    )
    assert.equal(body.isDynamic(), true)
    assert.equal(assignRotation.mock.callCount(), 0)
    assert.equal(assignNextRotation.mock.callCount(), 0)
    assert.equal(assignAngularVelocity.mock.callCount(), 0)
    assert.equal(assignType.mock.callCount(), 0)
  })
}

await test('a held book visibly deflects on collision, then returns to its stable camera-facing target', async (t) => {
  const physics = await loadPhysics()
  const world = makeWorld(physics)
  t.after(() => world.free())
  const dimensions = bookDimensions(0.66, 650)
  const holdPoint = { x: 0, y: 1.3, z: 0 }
  const body = makeBookBody(physics, world, dimensions, holdPoint)
  const target = cameraTarget(-13)
  body.setRotation(target, true)
  const dragTarget = createDragTarget(holdPoint, 0)
  const impactor = makeBookBody(physics, world, dimensions, {
    x: 2,
    y: 1.62,
    z: -0.1
  })
  impactor.setLinvel({ x: -6, y: 0, z: 3 }, true)
  let contacts = 0
  let biggestDeflection = 0
  let impactorPresent = true
  for (let step = 1; step <= 192; step++) {
    const time = step * PHYSICS_STEP
    // Withdraw the other book after impact so recovery is measured without an
    // object still wedged between the held cover and the tabletop.
    if (step === 60) {
      world.removeRigidBody(impactor)
      impactorPresent = false
    }
    body.resetForces(false)
    body.resetTorques(false)
    applyBookDrag(body, dragTarget, time)
    applyHeldBookTorque(body, target)
    world.step()
    if (impactorPresent)
      world.contactPair(body.collider(0), impactor.collider(0), (manifold) => {
        contacts += manifold.numContacts()
      })
    biggestDeflection = Math.max(
      biggestDeflection,
      angleBetween(body.rotation(), target)
    )
  }
  t.diagnostic(
    `Impact deflection: ${((biggestDeflection * 180) / Math.PI).toFixed(1)}°`
  )
  assert.ok(
    contacts > 0,
    'another dynamic book should actually strike the held book'
  )
  assert.ok(
    biggestDeflection > (5 * Math.PI) / 180,
    'contact should visibly deflect the held cover'
  )
  assert.ok(
    angleBetween(body.rotation(), target) < (4 * Math.PI) / 180,
    'the same target should recover after the impact'
  )
  assert.ok(
    Math.hypot(...Object.values(body.angvel())) < 0.15,
    'recovery should settle rather than keep wobbling'
  )
  assert.equal(body.isDynamic(), true)
})
