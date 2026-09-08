import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyBookDrag,
  createDragTarget,
  updateDragTarget
} from '../app/prototypes/reading-room/variants/physics-drag'
import {
  bookDimensions,
  loadPhysics,
  makeBookBody,
  makeWorld,
  PHYSICS_STEP
} from '../app/prototypes/reading-room/variants/physics-world'

await test('a dragged physical book follows a moving pointer within 50ms', async (t) => {
  const physics = await loadPhysics()
  const world = makeWorld(physics)
  t.after(() => world.free())
  const dimensions = bookDimensions(0.66, 600)
  const body = makeBookBody(physics, world, dimensions, {
    x: -2,
    y: 0.65,
    z: 0
  })
  const target = createDragTarget({ x: -2, y: 0.65, z: 0 }, 0)
  const speed = 3
  let totalLag = 0
  let samples = 0
  for (let step = 1; step <= 120; step++) {
    const time = step * PHYSICS_STEP
    // Desktop pointer input arrives at 60Hz while contacts run at 120Hz.
    if (step % 2 === 0)
      updateDragTarget(target, { x: -2 + speed * time, y: 0.65, z: 0 }, time)
    body.resetForces(false)
    applyBookDrag(body, target, time)
    world.step()
    if (time > 0.3) {
      totalLag += Math.abs(-2 + speed * time - body.translation().x) / speed
      samples++
    }
  }
  const lagMilliseconds = (totalLag / samples) * 1000
  t.diagnostic(`Mean moving-target lag: ${lagMilliseconds.toFixed(1)}ms`)
  assert.ok(
    lagMilliseconds < 50,
    `The book trails the pointer by ${lagMilliseconds.toFixed(1)}ms`
  )
})

await test('quick direction changes stay close and a stopped pointer does not keep pulling', async (t) => {
  const physics = await loadPhysics()
  const world = makeWorld(physics)
  t.after(() => world.free())
  const dimensions = bookDimensions(0.67, 1000)
  const body = makeBookBody(physics, world, dimensions, {
    x: -2,
    y: 0.65,
    z: 0
  })
  const target = createDragTarget({ x: -2, y: 0.65, z: 0 }, 0)
  let biggestMovingError = 0
  for (let step = 1; step <= 96; step++) {
    const time = step * PHYSICS_STEP
    const x = time <= 0.4 ? -2 + time * 8 : 1.2 - (time - 0.4) * 8
    if (step % 2 === 0) updateDragTarget(target, { x, y: 0.65, z: 0 }, time)
    body.resetForces(false)
    applyBookDrag(body, target, time)
    world.step()
    biggestMovingError = Math.max(
      biggestMovingError,
      Math.abs(x - body.translation().x)
    )
  }
  t.diagnostic(
    `Largest start/reversal error at 8 units/sec: ${biggestMovingError.toFixed(3)} units`
  )
  assert.ok(
    biggestMovingError < 0.4,
    'rapid tracking should remain within 50ms of pointer travel'
  )
  let overshoot = 0
  for (let step = 1; step <= 36; step++) {
    const time = 0.8 + step * PHYSICS_STEP
    body.resetForces(false)
    applyBookDrag(body, target, time)
    world.step()
    overshoot = Math.max(overshoot, target.position.x - body.translation().x)
  }
  t.diagnostic(`Stop overshoot: ${overshoot.toFixed(3)} units`)
  assert.ok(
    overshoot < 0.18,
    'stale target velocity should decay rather than fling the held book'
  )
  assert.ok(Math.abs(body.translation().x - target.position.x) < 0.015)
  assert.ok(Math.abs(body.linvel().x) < 0.025)
})

await test('a tightly tracked book pushes another book through real contacts and retains release momentum', async (t) => {
  const physics = await loadPhysics()
  const world = makeWorld(physics)
  t.after(() => world.free())
  const dimensions = bookDimensions(0.66, 650)
  const height = dimensions.height / 2 + 0.003
  const body = makeBookBody(physics, world, dimensions, {
    x: -2,
    y: height,
    z: 0
  })
  const neighbour = makeBookBody(physics, world, dimensions, {
    x: 0,
    y: height,
    z: 0
  })
  const target = createDragTarget({ x: -2, y: height, z: 0 }, 0)
  let contacts = 0
  let deepestActualContact = 0
  for (let step = 1; step <= 120; step++) {
    const time = step * PHYSICS_STEP
    if (step % 2 === 0)
      updateDragTarget(target, { x: -2 + time * 3, y: height, z: 0 }, time)
    body.resetForces(false)
    neighbour.resetForces(false)
    applyBookDrag(body, target, time)
    world.step()
    const actualContact = body
      .collider(0)
      .contactCollider(neighbour.collider(0), 0.02)
    if (actualContact)
      deepestActualContact = Math.min(
        deepestActualContact,
        actualContact.distance
      )
    world.contactPair(body.collider(0), neighbour.collider(0), (manifold) => {
      contacts += manifold.numContacts()
    })
  }
  assert.ok(
    contacts > 0,
    'the dragged book must actually collide with its neighbour'
  )
  t.diagnostic(
    `Deepest transient contact: ${deepestActualContact.toFixed(3)} units`
  )
  assert.ok(
    neighbour.translation().x > 1,
    'collision forces should move the obstructing book'
  )
  assert.ok(
    neighbour.translation().x > body.translation().x + dimensions.width * 0.85,
    'the dragged book must not tunnel through its neighbour'
  )
  assert.ok(
    deepestActualContact > -dimensions.width * 0.04,
    `transient contact penetration exceeded 4% of the book width: ${deepestActualContact}`
  )
  assert.equal(body.isDynamic(), true)
  const releasedAt = body.translation().x
  const releasedVelocity = body.linvel().x
  body.resetForces(true)
  for (let step = 0; step < 12; step++) world.step()
  assert.ok(
    releasedVelocity > 1,
    'the moving physical book should retain momentum at release'
  )
  assert.ok(
    body.translation().x > releasedAt + 0.04,
    'clearing the drag should not freeze or teleport the book'
  )
  for (let step = 0; step < 240; step++) world.step()
  const restingContact = body
    .collider(0)
    .contactCollider(neighbour.collider(0), 0.02)
  if (restingContact)
    assert.ok(
      restingContact.distance > -0.003,
      'any transient contact compression should resolve after release'
    )
})
