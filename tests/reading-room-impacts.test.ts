import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import type { BookImpact } from '../app/reading-room/room-audio'
import { createBookImpacts } from '../app/reading-room/scene/physics-impacts'
import {
  bookDimensions,
  loadPhysics,
  makeBookBody,
  makeWorld,
  PHYSICS_STEP
} from '../app/reading-room/scene/physics-world'

async function setup(t: TestContext) {
  const physics = await loadPhysics()
  const world = makeWorld(physics)
  const impacts = createBookImpacts(physics, world)
  const sounds: (BookImpact & { time: number })[] = []
  let time = 0
  t.after(() => {
    impacts.dispose()
    world.free()
  })
  return {
    world,
    sounds,
    book(x: number, y: number) {
      const body = makeBookBody(physics, world, bookDimensions(0.67, 500), {
        x,
        y,
        z: 0
      })
      impacts.track(body)
      return body
    },
    advance(seconds: number) {
      for (let i = 0; i < seconds / PHYSICS_STEP; i++) {
        impacts.beforeStep()
        world.step(impacts.queue)
        impacts.afterStep()
        time += PHYSICS_STEP * 1000
        if (i % 2 === 0)
          impacts.flush(time, (impact) => sounds.push({ ...impact, time }))
      }
    }
  }
}

await test('a landing makes a table sound, while a settled book stays quiet', async (t) => {
  const sim = await setup(t)
  sim.book(-2, 2)
  sim.advance(0.2)
  assert.equal(sim.sounds.length, 0, 'falling through empty air is silent')
  sim.advance(4)
  assert.ok(sim.sounds.some((sound) => sound.kind === 'table'))
  assert.ok(sim.sounds.every((sound) => sound.pan < 0))
  const settledCount = sim.sounds.length
  sim.advance(4)
  assert.equal(
    sim.sounds.length,
    settledCount,
    'support forces must stay silent'
  )
})

await test('books colliding in the air make book sounds without table sounds', async (t) => {
  const sim = await setup(t)
  const a = sim.book(-1, 3)
  const b = sim.book(1, 3)
  a.setGravityScale(0, true)
  b.setGravityScale(0, true)
  a.setLinvel({ x: 3, y: 0, z: 0 }, true)
  b.setLinvel({ x: -3, y: 0, z: 0 }, true)
  sim.advance(1)
  assert.ok(sim.sounds.length > 0)
  assert.ok(sim.sounds.every((sound) => sound.kind === 'book'))
  assert.ok(
    sim.sounds.every((sound) => sound.strength > 0 && sound.strength <= 1)
  )
})

await test('a supported stack and gentle tabletop sliding do not chatter', async (t) => {
  const sim = await setup(t)
  const height = bookDimensions(0.67, 500).height
  const books = Array.from({ length: 12 }, (_, i) =>
    sim.book(0, height * (i + 0.5) + 0.05)
  )
  sim.advance(6)
  sim.sounds.length = 0
  sim.advance(3)
  assert.equal(sim.sounds.length, 0)
  books.at(-1)!.setLinvel({ x: 0.12, y: 0, z: 0 }, true)
  sim.advance(0.5)
  assert.equal(sim.sounds.length, 0)
})
