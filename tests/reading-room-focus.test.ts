import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import { Quaternion, Vector3 } from 'three'

import type { LibraryData } from '../lib/library-schema'
import {
  alignCamera,
  makeCamera
} from '../app/prototypes/reading-room/variants/physics-camera'
import {
  makeFocusArrangement,
  resizeBookCollider
} from '../app/prototypes/reading-room/variants/physics-focus'
import {
  applyBookRearrangement,
  createBookRearrangement,
  makePileArrangement,
  type BookRearrangement
} from '../app/prototypes/reading-room/variants/physics-rearrange'
import {
  buildPileGroups,
  type PileGroup
} from '../app/prototypes/reading-room/variants/pile-groups'
import {
  applyPileBounds,
  bookDimensions,
  loadPhysics,
  makeBookBody,
  makeWorld,
  PHYSICS_STEP,
  TABLE_DEPTH,
  TABLE_WIDTH,
  type BookDimensions
} from '../app/prototypes/reading-room/variants/physics-world'

const library = JSON.parse(
  readFileSync(new URL('../data/library.json', import.meta.url), 'utf8')
) as LibraryData
const aspects = JSON.parse(
  readFileSync(new URL('../data/cover-aspects.json', import.meta.url), 'utf8')
) as Record<string, number>
// Match the live Big Pile's curated 25 covers followed by the remaining 61.
// Order changes which wide books share a row, so it affects the fit itself.
const displayIds = [
  '77566',
  '43419431',
  '20518872',
  '15839976',
  '222697645',
  '40514364',
  '18630',
  '77711',
  '910863',
  '18373',
  '1126719',
  '54659324',
  '23168817',
  '25451264',
  '6136470',
  '123224254',
  '32109569',
  '36681361',
  '375802',
  '827',
  '35009620',
  '35506021',
  '39706490',
  '21425079',
  '76620'
]
const books = [
  ...displayIds.map((id) => library.books.find((book) => book.id === id)!),
  ...library.books.filter(
    (book) => book.personal.rating === 5 && !displayIds.includes(book.id)
  )
]
const dimensionsById = new Map(
  books.map((book) => [
    book.id,
    bookDimensions(aspects[book.id]!, book.pageCount ?? 350)
  ])
)
const groups = (['genre', 'author', 'published'] as const).flatMap((mode) =>
  buildPileGroups(books, mode)
)

function focusBooks(group: PileGroup) {
  const members = new Set(group.books.map(({ id }) => id))
  return books
    .filter(({ id }) => members.has(id))
    .map(({ id }) => ({ id, dimensions: dimensionsById.get(id)! }))
}

interface Point {
  x: number
  y: number
}

function separated(first: Point[], second: Point[]) {
  for (const polygon of [first, second]) {
    for (let index = 0; index < polygon.length; index++) {
      const start = polygon[index]!
      const end = polygon[(index + 1) % polygon.length]!
      const axis = { x: start.y - end.y, y: end.x - start.x }
      const project = (point: Point) => point.x * axis.x + point.y * axis.y
      const a = first.map(project)
      const b = second.map(project)
      if (
        Math.max(...a) <= Math.min(...b) + 1e-9 ||
        Math.max(...b) <= Math.min(...a) + 1e-9
      )
        return true
    }
  }
  return false
}

function coverCorners(
  dimensions: BookDimensions,
  position: Vector3,
  rotation: Quaternion,
  scale: number,
  face = 1
) {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ].map(([x, z]) =>
    new Vector3(
      (x! * dimensions.width * scale) / 2,
      (face * dimensions.height * scale) / 2,
      (z! * dimensions.depth * scale) / 2
    )
      .applyQuaternion(rotation)
      .add(position)
  )
}

function assertNoOverlap(polygons: Map<string, Point[]>, context: string) {
  const entries = [...polygons]
  for (let first = 0; first < entries.length; first++)
    for (let second = first + 1; second < entries.length; second++)
      assert.ok(
        separated(entries[first]![1], entries[second]![1]),
        `${context}: covers ${entries[first]![0]} and ${entries[second]![0]} overlap`
      )
}

async function createWorld(t: TestContext) {
  const physics = await loadPhysics()
  const world = makeWorld(physics)
  t.after(() => world.free())
  return { physics, world }
}

void test('every real group exposes all of its covers within the table without overlap', () => {
  assert.equal(groups.length, 18)
  assert.equal(books.length, 86)
  const camera = makeCamera()
  alignCamera(camera)
  for (const group of groups) {
    const input = focusBooks(group)
    const before = structuredClone(input)
    const arrangement = makeFocusArrangement(input)
    assert.deepEqual(input, before, `${group.label}: source sizes changed`)
    assert.deepEqual(
      new Set(arrangement.targets.keys()),
      new Set(input.map(({ id }) => id)),
      `${group.label}: focus must retain every selected book exactly once`
    )
    assert.ok(
      arrangement.scale >= 0.68 && arrangement.scale <= 1,
      `${group.label}: unreadable or enlarged covers at scale ${arrangement.scale}`
    )
    if (input.length <= 12)
      assert.equal(
        arrangement.scale,
        1,
        `${group.label}: a small group should fit at its original size`
      )
    const worldCovers = new Map<string, Point[]>()
    const screenCovers = new Map<string, Point[]>()
    for (const { id, dimensions } of input) {
      const target = arrangement.targets.get(id)!
      const position = new Vector3().copy(target.position)
      const rotation = new Quaternion().copy(target.rotation)
      assert.ok(Math.abs(rotation.length() - 1) < 1e-6)
      const top = coverCorners(
        dimensions,
        position,
        rotation,
        arrangement.scale
      )
      const bottom = coverCorners(
        dimensions,
        position,
        rotation,
        arrangement.scale,
        -1
      )
      for (const point of [...top, ...bottom]) {
        assert.ok(
          Math.abs(point.x) < TABLE_WIDTH / 2 - 0.05 &&
            Math.abs(point.z) < TABLE_DEPTH / 2 - 0.05 &&
            point.y >= 0,
          `${group.label}/${id}: a book corner leaves the usable table`
        )
      }
      worldCovers.set(
        id,
        top.map(({ x, z }) => ({ x, y: z }))
      )
      screenCovers.set(
        id,
        top.map((point) => point.clone().project(camera))
      )
    }
    assertNoOverlap(worldCovers, group.label)
    assertNoOverlap(screenCovers, `${group.label} through the room camera`)
  }
})

await test('resizing every book preserves its body, collider, mass, pose and motion through repeated focus changes', async (t) => {
  const { physics, world } = await createWorld(t)
  const entries = books.map(({ id }, index) => {
    const dimensions = dimensionsById.get(id)!
    const body = makeBookBody(physics, world, dimensions, {
      x: (index % 7) * 0.2,
      y: 2 + index * 0.3,
      z: (index % 5) * 0.2
    })
    body.setLinvel({ x: 0.3, y: -0.2, z: 0.1 }, true)
    body.setAngvel({ x: -0.1, y: 0.2, z: 0.3 }, true)
    return {
      id,
      dimensions,
      body,
      collider: body.collider(0),
      position: { ...body.translation() },
      rotation: { ...body.rotation() },
      velocity: { ...body.linvel() },
      angular: { ...body.angvel() }
    }
  })
  for (const scale of [0.73, 0.91, 0.78, 1, 0.73, 1]) {
    for (const entry of entries) {
      const { id, body, collider, dimensions } = entry
      resizeBookCollider(body, dimensions, scale)
      assert.equal(world.getRigidBody(body.handle), body)
      assert.equal(body.collider(0), collider)
      assert.equal(collider.isEnabled(), true)
      assert.equal(body.isDynamic(), true)
      assert.deepEqual({ ...body.translation() }, entry.position)
      assert.deepEqual({ ...body.rotation() }, entry.rotation)
      assert.deepEqual({ ...body.linvel() }, entry.velocity)
      assert.deepEqual({ ...body.angvel() }, entry.angular)
      assert.ok(Math.abs(collider.mass() - dimensions.mass) < 1e-6)
      const extents = collider.halfExtents()!
      const radius = collider.roundRadius()
      for (const [axis, dimension] of [
        ['x', 'width'],
        ['y', 'height'],
        ['z', 'depth']
      ] as const)
        assert.ok(
          Math.abs(
            (extents[axis] + radius) * 2 - dimensions[dimension] * scale
          ) < 1e-6,
          `${id}: collider ${dimension} must match the visible scale`
        )
    }
    assert.equal(world.bodies.len(), 87)
    assert.equal(world.colliders.len(), 87)
  }
})

await test('the largest group travels from its pile and settles with live focus bounds without drift or overlap', async (t) => {
  const { physics, world } = await createWorld(t)
  const largest = groups.reduce((best, group) =>
    group.books.length > best.books.length ? group : best
  )
  assert.equal(largest.books.length, 24)
  const input = focusBooks(largest)
  const arrangement = makeFocusArrangement(input)
  assert.ok(arrangement.scale < 1)
  const entries = input.map(({ id, dimensions }, index) => {
    const target = arrangement.targets.get(id)!
    const body = makeBookBody(physics, world, dimensions, {
      x: 0,
      y: index * dimensions.height,
      z: 0
    })
    return {
      id,
      dimensions,
      target,
      body,
      guide: undefined as BookRearrangement | undefined
    }
  })
  const pile = makePileArrangement(entries, [largest], 'genre')
  for (const entry of entries) {
    const { id, dimensions, target, body } = entry
    const start = pile.targets.get(id)!
    body.setTranslation(start.position, true)
    body.setRotation(start.rotation, true)
    resizeBookCollider(body, dimensions, arrangement.scale)
    entry.guide = createBookRearrangement(body, target, 0)
  }
  let released = 0
  for (let step = 1; step <= 6 / PHYSICS_STEP; step++) {
    for (const entry of entries) {
      const { body, dimensions, guide } = entry
      if (guide) {
        if (applyBookRearrangement(body, guide, step * PHYSICS_STEP)) continue
        entry.guide = undefined
        released++
      }
      body.resetForces(false)
      body.resetTorques(false)
      applyPileBounds(body, dimensions, 3.85, 2.3)
    }
    world.step()
  }
  assert.equal(released, 24)
  const polygons = new Map<string, Point[]>()
  for (const { id, dimensions, target, body } of entries) {
    assert.equal(body.isDynamic(), true)
    assert.equal(body.collider(0).isEnabled(), true)
    const position = new Vector3().copy(body.translation())
    assert.ok(
      Math.abs(position.y - (dimensions.height * arrangement.scale) / 2) <
        0.007,
      `${id}: scaled collider must rest on the tabletop`
    )
    assert.ok(
      Math.hypot(
        position.x - target.position.x,
        position.z - target.position.z
      ) < 0.015,
      `${id}: the focused cover moved into another book's space`
    )
    const velocity = body.linvel()
    assert.ok(Math.hypot(velocity.x, velocity.y, velocity.z) < 0.025)
    polygons.set(
      id,
      coverCorners(
        dimensions,
        position,
        new Quaternion().copy(body.rotation()),
        arrangement.scale
      ).map(({ x, z }) => ({ x, y: z }))
    )
  }
  assertNoOverlap(polygons, 'Settled largest group')
})

await test('all 86 parked and focused books return to their groups with the original physical bodies', async (t) => {
  for (const grouping of ['genre', 'author', 'published'] as const) {
    for (const reduced of [false, true]) {
      await t.test(`${grouping}, reduced motion ${reduced}`, async (t) => {
        const { physics, world } = await createWorld(t)
        let time = 0
        const entries = books.map(({ id }, index) => {
          const dimensions = dimensionsById.get(id)!
          const body = makeBookBody(physics, world, dimensions, {
            x: 0,
            y: index * 0.3,
            z: 0
          })
          return {
            id,
            dimensions,
            body,
            handle: body.handle,
            colliderHandle: body.collider(0).handle,
            guide: undefined as BookRearrangement | undefined
          }
        })
        const currentGroups = buildPileGroups(books, grouping)
        const original = makePileArrangement(entries, currentGroups, grouping)
        for (const { id, body } of entries) {
          const target = original.targets.get(id)!
          body.setTranslation(target.position, true)
          body.setRotation(target.rotation, true)
        }
        const advance = (seconds: number, focused: boolean) => {
          for (let step = 0; step < seconds / PHYSICS_STEP; step++) {
            time += PHYSICS_STEP
            for (const entry of entries) {
              const { body, dimensions, guide } = entry
              if (guide) {
                if (applyBookRearrangement(body, guide, time)) continue
                entry.guide = undefined
              }
              if (!body.isEnabled() || !body.isDynamic()) continue
              body.resetForces(false)
              body.resetTorques(false)
              applyPileBounds(body, dimensions, 3.85, focused ? 2.3 : 2.13)
            }
            world.step()
          }
        }
        advance(3, false)
        const largest = currentGroups.reduce((best, group) =>
          group.books.length > best.books.length ? group : best
        )
        const members = new Set(largest.books.map(({ id }) => id))
        const focused = makeFocusArrangement(
          entries.filter(({ id }) => members.has(id))
        )
        for (const entry of entries) {
          const { id, body, dimensions } = entry
          if (members.has(id)) {
            resizeBookCollider(body, dimensions, focused.scale)
            entry.guide = createBookRearrangement(
              body,
              focused.targets.get(id)!,
              time,
              reduced
            )
          } else {
            // Begin after the exit animation: normal motion parks offscreen;
            // reduced motion hides the same body at its current position.
            const point = body.translation()
            if (!reduced)
              body.setTranslation(
                { x: point.x < 0 ? -13 : 13, y: point.y + 0.16, z: point.z },
                true
              )
            body.setLinvel({ x: 0, y: 0, z: 0 }, true)
            body.setAngvel({ x: 0, y: 0, z: 0 }, true)
            body.setBodyType(physics.RigidBodyType.KinematicPositionBased, true)
            body.collider(0).setEnabled(false)
            body.setEnabled(false)
          }
        }
        advance(6, true)
        const returning = makePileArrangement(entries, currentGroups, grouping)
        for (const { id, body, dimensions } of entries) {
          body.setEnabled(true)
          body.collider(0).setEnabled(true)
          resizeBookCollider(body, dimensions, 1)
          entries.find((entry) => entry.id === id)!.guide =
            createBookRearrangement(
              body,
              returning.targets.get(id)!,
              time,
              reduced
            )
        }
        advance(10, false)
        assert.equal(world.bodies.len(), 87)
        assert.equal(world.colliders.len(), 87)
        for (const { id, body, handle, colliderHandle, guide } of entries) {
          assert.equal(body.handle, handle)
          assert.equal(body.collider(0).handle, colliderHandle)
          assert.equal(body.isEnabled(), true)
          assert.equal(body.isDynamic(), true)
          assert.equal(body.collider(0).isEnabled(), true)
          assert.equal(guide, undefined)
          const position = body.translation()
          const target = returning.targets.get(id)!.position
          assert.ok(
            position.y > 0 &&
              Math.hypot(position.x - target.x, position.z - target.z) < 0.06,
            `${id}: returning from focus must restore its assigned pile`
          )
          const velocity = body.linvel()
          assert.ok(Math.hypot(velocity.x, velocity.y, velocity.z) < 0.025)
        }
      })
    }
  }
})
