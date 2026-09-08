import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import {
  getPileDrop,
  scatterAbove
} from '../app/prototypes/reading-room/variants/physics-pile'
import {
  bookDimensions,
  loadPhysics,
  makeBookBody,
  makeWorld,
  PHYSICS_STEP,
  TABLE_DEPTH,
  TABLE_WIDTH,
  type BookBody,
  type BookDimensions,
  type Physics
} from '../app/prototypes/reading-room/variants/physics-world'

let physics: Physics
before(async () => {
  physics = await loadPhysics()
})

void test('drop schedule is repeatable and keeps initially tilted books above the tabletop', () => {
  const dimensions = bookDimensions(0.65, 500)
  const drops = Array.from({ length: 25 }, (_, index) =>
    getPileDrop(index, 25, false, dimensions)
  )
  assert.deepEqual(
    drops,
    Array.from({ length: 25 }, (_, index) =>
      getPileDrop(index, 25, false, dimensions)
    )
  )
  for (const [index, drop] of drops.entries()) {
    assert.ok(drop.position.y >= 6)
    assert.ok(Math.abs(drop.position.x) < TABLE_WIDTH / 2 - dimensions.width)
    assert.ok(
      Math.abs(drop.position.z) < TABLE_DEPTH / 2 - dimensions.depth / 2
    )
    assert.ok(Math.abs(Math.hypot(...Object.values(drop.rotation)) - 1) < 1e-8)
    assert.ok(1 - 2 * (drop.rotation.x ** 2 + drop.rotation.z ** 2) > 0.94)
    if (index > 0) assert.ok(drop.delayMs > drops[index - 1]!.delayMs)
  }
  assert.ok(
    drops.at(-1)!.delayMs <= 1000,
    'The 25-book release finishes in one second'
  )
})

void test('scatter affects obstructing books above the selection without moving lower or distant books', () => {
  const world = makeWorld(physics)
  const dimensions = bookDimensions(0.65, 500)
  const selected = makeBookBody(physics, world, dimensions, {
    x: 0,
    y: 0.3,
    z: 0
  })
  const above = makeBookBody(physics, world, dimensions, {
    x: 0.2,
    y: 0.65,
    z: 0.1
  })
  const below = makeBookBody(physics, world, dimensions, { x: 0, y: 0.1, z: 0 })
  const distant = makeBookBody(physics, world, dimensions, {
    x: 3.5,
    y: 0.7,
    z: 0
  })
  const selectedPosition = { ...selected.translation() }
  const abovePosition = { ...above.translation() }
  assert.equal(
    scatterAbove(
      selected,
      [selected, above, below, distant].map((body) => ({ body, dimensions }))
    ),
    1
  )
  assert.deepEqual({ ...selected.translation() }, selectedPosition)
  assert.deepEqual({ ...above.translation() }, abovePosition)
  assert.ok(above.linvel().y > 0.5)
  assert.ok(above.linvel().x > 0)
  assert.ok(Math.hypot(...Object.values(above.linvel())) < 2.7)
  assert.deepEqual({ ...below.linvel() }, { x: 0, y: 0, z: 0 })
  assert.deepEqual({ ...distant.linvel() }, { x: 0, y: 0, z: 0 })
  world.free()
})

void test('all 25 varied books fall, collide, and settle without automatic orientation correction', () => {
  const world = makeWorld(physics)
  const books: {
    body: BookBody
    dimensions: BookDimensions
    delayMs: number
  }[] = Array.from({ length: 25 }, (_, index) => {
    const dimensions = bookDimensions(
      0.57 + (index % 5) * 0.035,
      250 + index * 25
    )
    const drop = getPileDrop(index, 25, false, dimensions)
    const body = makeBookBody(physics, world, dimensions, drop.position)
    body.setRotation(drop.rotation, true)
    body.setEnabled(false)
    return { body, dimensions, delayMs: drop.delayMs }
  })
  for (let frame = 0; frame < 1680; frame++) {
    for (const entry of books) {
      if (frame * PHYSICS_STEP * 1000 < entry.delayMs) continue
      if (!entry.body.isEnabled()) {
        entry.body.setEnabled(true)
        entry.body.setLinvel({ x: 0, y: -12, z: 0 }, true)
      }
      entry.body.resetForces(false)
      entry.body.resetTorques(false)
    }
    world.step()
  }
  for (const [index, { body }] of books.entries()) {
    const position = body.translation()
    assert.ok(position.y > 0, `Book ${index} fell off the table`)
    assert.ok(position.y < 2.5, `Book ${index} has not settled: ${position.y}`)
    assert.ok(Math.abs(position.x) < TABLE_WIDTH / 2)
    assert.ok(Math.abs(position.z) < TABLE_DEPTH / 2)
    assert.ok(
      Math.hypot(...Object.values(body.angvel())) < 0.4,
      `Book ${index} is still spinning`
    )
  }
  assert.ok(books.some(({ body }) => body.translation().y > 0.45))
  world.free()
})
