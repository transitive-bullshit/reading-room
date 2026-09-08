import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import type RAPIER from '@dimforge/rapier3d-compat'

import {
  applyCoverUpTorque,
  bookDimensions,
  loadPhysics,
  makeBookBody,
  makeWorld,
  PHYSICS_STEP,
  type BookBody,
  type BookDimensions
} from '../app/prototypes/reading-room/variants/physics-world'

interface SimulatedBook {
  body: BookBody
  dimensions: BookDimensions
}

async function createWorld(t: TestContext) {
  const physics = await loadPhysics()
  const world = makeWorld(physics)
  t.after(() => world.free())
  return { physics, world }
}

function advance(
  world: RAPIER.World,
  books: SimulatedBook[],
  seconds: number,
  afterStep?: () => void
) {
  for (let step = 0; step < Math.ceil(seconds / PHYSICS_STEP); step++) {
    for (const { body, dimensions } of books) {
      body.resetForces(false)
      body.resetTorques(false)
      applyCoverUpTorque(body, dimensions.mass)
    }
    world.step()
    afterStep?.()
  }
}

function magnitude(vector: RAPIER.Vector) {
  return Math.hypot(vector.x, vector.y, vector.z)
}

function coverUp(body: BookBody) {
  const rotation = body.rotation()
  // Dot product of the book's local +Y cover normal with world +Y.
  return 1 - 2 * (rotation.x ** 2 + rotation.z ** 2)
}

function near(
  actual: number,
  expected: number,
  tolerance: number,
  label: string
) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, received ${actual}`
  )
}

function assertSettled(body: BookBody) {
  assert.ok(magnitude(body.linvel()) < 0.02, 'linear motion should settle')
  assert.ok(magnitude(body.angvel()) < 0.03, 'angular motion should settle')
}

function assertContact(
  world: RAPIER.World,
  first: RAPIER.Collider,
  second: RAPIER.Collider
) {
  const contact = first.contactCollider(second, 0.02)
  assert.ok(contact, 'the two physical surfaces should remain in contact')
  // Rapier permits a small solver slop; 3mm is under 2% of these book blocks.
  assert.ok(contact.distance >= -0.003, `penetration was ${contact.distance}`)
  assert.ok(contact.distance <= 0.008, `surface gap was ${contact.distance}`)

  let contacts = 0
  world.contactPair(first, second, (manifold) => {
    contacts += manifold.numContacts()
    for (let index = 0; index < manifold.numContacts(); index++) {
      assert.ok(manifold.contactDist(index) >= -0.003)
    }
  })
  assert.ok(contacts > 0, 'the solver should retain a contact manifold')
}

function tableCollider(world: RAPIER.World) {
  let table: RAPIER.Collider | undefined
  world.forEachCollider((collider) => {
    if (collider.parent()?.isFixed()) table = collider
  })
  assert.ok(table, 'makeWorld should include a fixed tabletop')
  return table
}

await test('three books settle into supported contact without penetrating the stack', async (t) => {
  const { physics, world } = await createWorld(t)
  const dimensions = bookDimensions(0.68, 550)
  const books = [0, 1, 2].map((index) => ({
    dimensions,
    body: makeBookBody(
      physics,
      world,
      dimensions,
      { x: index * 0.025, y: dimensions.height * (index + 0.5) + 0.1, z: 0 },
      [0, 0.07, -0.04][index]
    )
  }))

  advance(world, books, 6)

  for (const [index, { body }] of books.entries()) {
    near(
      body.translation().y,
      dimensions.height * (index + 0.5),
      0.012,
      'stack height'
    )
    assert.ok(coverUp(body) > 0.995, 'each book should remain cover-up')
    assertSettled(body)
  }
  assertContact(world, books[0]!.body.collider(0), tableCollider(world))
  assertContact(world, books[0]!.body.collider(0), books[1]!.body.collider(0))
  assertContact(world, books[1]!.body.collider(0), books[2]!.body.collider(0))
})

await test('removing the supporting book wakes the upper book, which falls and settles on the table', async (t) => {
  const { physics, world } = await createWorld(t)
  const dimensions = bookDimensions(0.66, 700)
  const lower = makeBookBody(physics, world, dimensions, {
    x: 0,
    y: dimensions.height / 2 + 0.12,
    z: 0
  })
  const upper = makeBookBody(
    physics,
    world,
    dimensions,
    { x: 0.12, y: dimensions.height * 1.5 + 0.12, z: 0.08 },
    0.09
  )
  advance(
    world,
    [
      { body: lower, dimensions },
      { body: upper, dimensions }
    ],
    5
  )
  assertContact(world, lower.collider(0), upper.collider(0))
  assertSettled(upper)
  const supportedHeight = upper.translation().y

  world.removeRigidBody(lower)
  assert.equal(lower.isValid(), false)

  let greatestDownwardSpeed = 0
  advance(world, [{ body: upper, dimensions }], 0.5, () => {
    greatestDownwardSpeed = Math.max(greatestDownwardSpeed, -upper.linvel().y)
  })
  assert.ok(
    greatestDownwardSpeed > 0.2,
    'gravity should accelerate the unsupported book'
  )
  assert.ok(
    upper.translation().y < supportedHeight - dimensions.height * 0.65,
    'the upper book should lose the removed support height'
  )

  advance(world, [{ body: upper, dimensions }], 5)
  near(
    upper.translation().y,
    dimensions.height / 2,
    0.008,
    'final table height'
  )
  assertContact(world, upper.collider(0), tableCollider(world))
  assertSettled(upper)
})

for (const { name, angle, sleeping } of [
  { name: 'tilted', angle: Math.PI / 3, sleeping: false },
  { name: 'nearly inverted', angle: Math.PI - 0.015, sleeping: false },
  { name: 'exactly inverted and sleeping', angle: Math.PI, sleeping: true }
]) {
  await test(`cover-up torque turns an airborne ${name} book through simulation, without assigning its pose`, async (t) => {
    const { physics, world } = await createWorld(t)
    const dimensions = bookDimensions(0.64, 450)
    const body = makeBookBody(physics, world, dimensions, { x: 0, y: 3, z: 0 })
    // Isolate the angular spring from impacts and gravity. The stack tests cover contacts.
    body.setGravityScale(0, true)
    body.setRotation(
      { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) },
      true
    )
    if (sleeping) body.sleep()
    const positionBefore = { ...body.translation() }
    const rotationBefore = { ...body.rotation() }
    const assignRotation = t.mock.method(body, 'setRotation')
    const assignNextRotation = t.mock.method(body, 'setNextKinematicRotation')
    const assignTranslation = t.mock.method(body, 'setTranslation')

    applyCoverUpTorque(body, dimensions.mass)

    assert.deepEqual({ ...body.rotation() }, rotationBefore)
    assert.deepEqual({ ...body.translation() }, positionBefore)
    assert.equal(
      magnitude(body.angvel()),
      0,
      'adding torque must wait for the integrator'
    )
    const torque = body.userTorque()
    assert.ok(
      magnitude(torque) > 0.01,
      'even the exact inverted pose needs a turning axis'
    )
    assert.ok(
      magnitude(torque) <= dimensions.mass * 0.53,
      'initial restoring torque should be bounded'
    )
    near(torque.y, 0, 1e-8, 'cover-up torque should not steer yaw')
    assert.equal(
      body.isSleeping(),
      false,
      'an inverted sleeping body must wake'
    )

    advance(world, [{ body, dimensions }], PHYSICS_STEP)
    assert.notDeepEqual(
      { ...body.rotation() },
      rotationBefore,
      'only stepping the world should rotate the book'
    )
    assert.ok(magnitude(body.angvel()) > 0)
    advance(world, [{ body, dimensions }], 15)

    assert.ok(coverUp(body) > 0.995, `cover normal ended at ${coverUp(body)}`)
    assertSettled(body)
    near(
      body.translation().y,
      positionBefore.y,
      1e-5,
      'torque should not move the center of mass'
    )
    assert.equal(assignRotation.mock.callCount(), 0)
    assert.equal(assignNextRotation.mock.callCount(), 0)
    assert.equal(assignTranslation.mock.callCount(), 0)
  })
}

await test('disposing a world does not invalidate another world or a fresh world sharing Rapier', async (t) => {
  const physics = await loadPhysics()
  const disposed = makeWorld(physics)
  let disposedFreed = false
  t.after(() => {
    if (!disposedFreed) disposed.free()
  })
  const { world: survivor } = await createWorld(t)
  const dimensions = bookDimensions(0.7, 300)
  const survivorBook = makeBookBody(physics, survivor, dimensions, {
    x: 0,
    y: 0.5,
    z: 0
  })
  makeBookBody(physics, disposed, dimensions, { x: 0, y: 0.5, z: 0 })
  disposed.step()
  assert.doesNotThrow(() => disposed.free())
  disposedFreed = true

  advance(survivor, [{ body: survivorBook, dimensions }], 4)
  near(
    survivorBook.translation().y,
    dimensions.height / 2,
    0.008,
    'surviving world'
  )
  assertSettled(survivorBook)

  const { world: fresh } = await createWorld(t)
  const freshBook = makeBookBody(physics, fresh, dimensions, {
    x: 0,
    y: 0.5,
    z: 0
  })
  advance(fresh, [{ body: freshBook, dimensions }], 4)
  near(freshBook.translation().y, dimensions.height / 2, 0.008, 'fresh world')
  assertContact(fresh, freshBook.collider(0), tableCollider(fresh))
  assertSettled(freshBook)
})
