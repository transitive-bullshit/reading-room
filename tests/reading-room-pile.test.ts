import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, test } from 'node:test'
import * as THREE from 'three'

import { getFeaturedBooks } from '../lib/featured-books'
import type { LibraryData } from '../lib/library-schema'
import {
  alignCamera,
  makeCamera,
  offscreenDropPosition
} from '../app/reading-room/scene/physics-camera'
import {
  getPileDrop,
  scatterAbove
} from '../app/reading-room/scene/physics-pile'
import {
  applyPileBounds,
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
} from '../app/reading-room/scene/physics-world'

let physics: Physics
const library = JSON.parse(
  readFileSync(new URL('../data/library.json', import.meta.url), 'utf8')
) as LibraryData
const aspects = JSON.parse(
  readFileSync(new URL('../data/cover-aspects.json', import.meta.url), 'utf8')
) as Record<string, number>
const featuredBooks = getFeaturedBooks(library.books)
const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length

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

void test('the featured drop has broad balanced tails and a denser middle', () => {
  const drops = featuredBooks.map((book, index) =>
    getPileDrop(
      index,
      featuredBooks.length,
      false,
      bookDimensions(aspects[book.id]!, book.pageCount ?? 350)
    )
  )
  const xs = drops.map(({ position }) => position.x).sort((a, b) => a - b)
  const center = xs.filter((x) => Math.abs(x) < 1.2).length / xs.length
  const leftTail = xs.filter((x) => x < -2.2).length
  const rightTail = xs.filter((x) => x > 2.2).length
  const deviation = Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)))

  assert.ok(center >= 0.45 && center <= 0.6, `Central share: ${center}`)
  assert.ok(Math.abs(mean(xs)) < 0.1, `Horizontal bias: ${mean(xs)}`)
  assert.ok(deviation > 1.6 && deviation < 2.1, `Drop width: ${deviation}`)
  assert.ok(leftTail >= xs.length * 0.08 && rightTail >= xs.length * 0.08)
  assert.ok(Math.abs(leftTail - rightTail) <= 1, 'Both tails stay balanced')
  assert.ok(xs[Math.floor(xs.length * 0.05)]! < -2.7)
  assert.ok(xs[Math.floor(xs.length * 0.95)]! > 2.7)
  for (const { position } of drops) {
    assert.ok(
      Math.abs(position.x) < 3.5,
      'No books accumulate at a clamped edge'
    )
    assert.ok(Math.abs(position.z) < 1.7)
  }
})

void test('the featured books settle into a broad base with a central crown on desktop and mobile', async (t) => {
  for (const mobile of [false, true]) {
    await t.test(mobile ? 'mobile' : 'desktop', (t) => {
      const world = makeWorld(physics)
      t.after(() => world.free())
      const camera = makeCamera()
      if (mobile) alignCamera(camera, (390 / (844 / 900) - 30) / 810, 0.9, 565)
      else alignCamera(camera)

      const entries = featuredBooks.map((book, index) => {
        const dimensions = bookDimensions(
          aspects[book.id]!,
          book.pageCount ?? 350
        )
        const drop = getPileDrop(
          index,
          featuredBooks.length,
          mobile,
          dimensions
        )
        const rotation = new THREE.Quaternion(
          drop.rotation.x,
          drop.rotation.y,
          drop.rotation.z,
          drop.rotation.w
        )
        const from = offscreenDropPosition(
          camera,
          dimensions,
          rotation,
          new THREE.Vector3(drop.position.x, drop.position.y, drop.position.z)
        )
        const body = makeBookBody(physics, world, dimensions, from)
        body.setRotation(rotation, true)
        body.setEnabled(false)
        return { body, dimensions, start: 0.08 + drop.delayMs / 1000 }
      })

      for (let step = 0; step < 12 / PHYSICS_STEP; step++) {
        for (const { body, dimensions, start } of entries) {
          if (step * PHYSICS_STEP < start) continue
          if (!body.isEnabled()) {
            body.setEnabled(true)
            body.setLinvel({ x: 0, y: -12, z: 0 }, true)
          }
          body.resetForces(false)
          body.resetTorques(false)
          applyPileBounds(body, dimensions, mobile ? 2.65 : 3.85)
        }
        world.step()
      }

      const settled = entries.map(({ body, dimensions }) => {
        const point = body.translation()
        const rotation = body.rotation()
        const quaternion = new THREE.Quaternion(
          rotation.x,
          rotation.y,
          rotation.z,
          rotation.w
        )
        const corners: THREE.Vector3[] = []
        for (const x of [-1, 1])
          for (const y of [-1, 1])
            for (const z of [-1, 1])
              corners.push(
                new THREE.Vector3(
                  (x * dimensions.width) / 2,
                  (y * dimensions.height) / 2,
                  (z * dimensions.depth) / 2
                )
                  .applyQuaternion(quaternion)
                  .add(new THREE.Vector3(point.x, point.y, point.z))
              )
        assert.ok(
          body.isEnabled() && body.isDynamic() && body.collider(0).isEnabled()
        )
        assert.ok(
          point.y > 0 && point.y < 2.6,
          'Every book stays on the low mound'
        )
        assert.ok(Math.abs(point.x) < TABLE_WIDTH / 2)
        assert.ok(Math.abs(point.z) < TABLE_DEPTH / 2)
        assert.ok(Math.hypot(...Object.values(body.linvel())) < 0.01)
        assert.ok(Math.hypot(...Object.values(body.angvel())) < 0.01)
        return {
          x: point.x,
          top: Math.max(...corners.map((corner) => corner.y)),
          left: Math.min(...corners.map((corner) => corner.x)),
          right: Math.max(...corners.map((corner) => corner.x))
        }
      })
      const center = settled.filter(({ x }) => Math.abs(x) < 1.2)
      const edges = settled.filter(({ x }) => Math.abs(x) > 2.2)
      const centerMean = mean(center.map(({ top }) => top))
      const edgeMean = mean(edges.map(({ top }) => top))
      const centerPeak = Math.max(...center.map(({ top }) => top))
      const edgePeak = Math.max(...edges.map(({ top }) => top))
      const width =
        Math.max(...settled.map(({ right }) => right)) -
        Math.min(...settled.map(({ left }) => left))

      assert.ok(center.length >= featuredBooks.length * 0.3)
      assert.ok(
        edges.length >= featuredBooks.length * 0.2,
        'The mound keeps a broad base'
      )
      assert.ok(
        centerMean > edgeMean * 1.25,
        `Center ${centerMean}, edges ${edgeMean}`
      )
      assert.ok(
        centerPeak > edgePeak + 0.2,
        `Central crown ${centerPeak}, edge peak ${edgePeak}`
      )
      assert.ok(
        Math.max(...settled.map(({ top }) => top)) < 3,
        'No tall central needle'
      )
      assert.ok(Math.abs(mean(settled.map(({ x }) => x))) < 0.25)
      assert.ok(width > (mobile ? 7 : 8), `Base width: ${width}`)
      t.diagnostic(
        JSON.stringify({
          count: featuredBooks.length,
          width,
          centerMean,
          edgeMean,
          centerPeak,
          edgePeak
        })
      )
    })
  }
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
