import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import * as THREE from 'three'

import type { LibraryData } from '../lib/library-schema'
import {
  alignCamera,
  makeCamera,
  offscreenDropPosition
} from '../app/prototypes/reading-room/variants/physics-camera'
import { getPileDrop } from '../app/prototypes/reading-room/variants/physics-pile'
import {
  createMoundMemory,
  type MoundSeed
} from '../app/prototypes/reading-room/variants/physics-mound'
import {
  buildPileGroups,
  type PileGrouping
} from '../app/prototypes/reading-room/variants/pile-groups'
import {
  applyBookRearrangement,
  createBookRearrangement,
  makePileArrangement,
  type BookRearrangement
} from '../app/prototypes/reading-room/variants/physics-rearrange'
import {
  applyPileBounds,
  bookDimensions,
  loadPhysics,
  makeBookBody,
  makeWorld,
  PHYSICS_STEP
} from '../app/prototypes/reading-room/variants/physics-world'

const library = JSON.parse(
  readFileSync(new URL('../data/library.json', import.meta.url), 'utf8')
) as LibraryData
const aspects = JSON.parse(
  readFileSync(new URL('../data/cover-aspects.json', import.meta.url), 'utf8')
) as Record<string, number>
// Match the live Big Pile's curated 25 covers followed by the remaining 61.
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

async function setup(t: TestContext) {
  const physics = await loadPhysics()
  const world = makeWorld(physics)
  const camera = makeCamera()
  alignCamera(camera)
  t.after(() => world.free())
  let time = 0
  let currentGrouping: PileGrouping = 'free'
  const seeds: MoundSeed[] = []
  const entries = books.map((book, index) => {
    const dimensions = bookDimensions(aspects[book.id]!, book.pageCount ?? 350)
    const drop = getPileDrop(index, books.length, false, dimensions)
    const rotation = new THREE.Quaternion(
      drop.rotation.x,
      drop.rotation.y,
      drop.rotation.z,
      drop.rotation.w
    )
    const position = offscreenDropPosition(
      camera,
      dimensions,
      rotation,
      new THREE.Vector3(drop.position.x, drop.position.y, drop.position.z)
    )
    const body = makeBookBody(physics, world, dimensions, position)
    body.setRotation(rotation, true)
    body.setEnabled(false)
    seeds.push({
      id: book.id,
      dimensions,
      position: { x: position.x, y: position.y, z: position.z },
      rotation: { ...drop.rotation },
      delayMs: drop.delayMs
    })
    return {
      id: book.id,
      body,
      dimensions,
      active: false,
      start: 0.08 + drop.delayMs / 1000,
      guide: undefined as BookRearrangement | undefined
    }
  })
  const memory = createMoundMemory(physics, seeds, 3.85)
  t.after(() => memory.dispose())
  return {
    entries,
    memory,
    async arrange(grouping: PileGrouping) {
      const moundTargets = await memory.remember(
        entries,
        currentGrouping === 'free'
      )
      const arrangement = makePileArrangement(
        entries,
        buildPileGroups(books, grouping),
        grouping,
        moundTargets
      )
      currentGrouping = grouping
      for (const entry of entries) {
        entry.body.setEnabled(true)
        entry.active = true
        entry.guide = createBookRearrangement(
          entry.body,
          arrangement.targets.get(entry.id)!,
          time
        )
      }
      return arrangement
    },
    advance(
      seconds: number,
      observe?: {
        afterStep?: () => void
        onRelease?: (id: string, verticalSpeed: number) => void
      }
    ) {
      for (let step = 0; step < Math.ceil(seconds / PHYSICS_STEP); step++) {
        time += PHYSICS_STEP
        for (const entry of entries) {
          const { body } = entry
          if (!entry.active && time >= entry.start) {
            entry.active = true
            body.setEnabled(true)
            body.setLinvel({ x: 0, y: -12, z: 0 }, true)
          }
          if (!entry.active) continue
          if (entry.guide) {
            if (applyBookRearrangement(body, entry.guide, time)) continue
            entry.guide = undefined
            observe?.onRelease?.(entry.id, body.linvel().y)
          }
          if (!body.isDynamic()) continue
          body.resetForces(false)
          body.resetTorques(false)
          applyPileBounds(body, entry.dimensions, 3.85)
        }
        world.step()
        observe?.afterStep?.()
      }
    }
  }
}

type Arrangement = ReturnType<typeof makePileArrangement>

type Simulation = Awaited<ReturnType<typeof setup>>
interface BookPose {
  position: THREE.Vector3Like
  rotation: THREE.QuaternionLike
}
type MoundPoses = ReadonlyMap<string, BookPose>

function snapshot(sim: Simulation): MoundPoses {
  return new Map(
    sim.entries.map(({ id, body }) => [
      id,
      {
        position: { ...body.translation() },
        rotation: { ...body.rotation() }
      }
    ])
  )
}

function naturalOrientation(poses: MoundPoses) {
  const headings: number[] = []
  let tilted = 0
  for (const { rotation } of poses.values()) {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation)
    const tilt = Math.acos(Math.min(1, Math.abs(up.y)))
    if (tilt >= (5 * Math.PI) / 180) tilted++
    headings.push(Math.atan2(-right.z, right.x))
  }
  // Axial headings treat a book rotated 180 degrees as the same edge direction.
  // Concentration near one means almost every book has parallel edges.
  return {
    tiltedFraction: tilted / poses.size,
    headingConcentration:
      Math.hypot(
        headings.reduce((sum, angle) => sum + Math.cos(2 * angle), 0),
        headings.reduce((sum, angle) => sum + Math.sin(2 * angle), 0)
      ) / headings.length
  }
}

function assertNaturalOrientation(actual: MoundPoses, initial: MoundPoses) {
  const before = naturalOrientation(initial)
  const after = naturalOrientation(actual)
  assert.ok(
    after.tiltedFraction >= before.tiltedFraction * 0.75,
    `Free lost the natural tilts: ${(after.tiltedFraction * 100).toFixed(1)}% vs ${(before.tiltedFraction * 100).toFixed(1)}% initially`
  )
  assert.ok(
    Math.abs(after.headingConcentration - before.headingConcentration) < 0.15,
    `Free changed the natural heading spread: ${after.headingConcentration.toFixed(3)} vs ${before.headingConcentration.toFixed(3)} initially`
  )
}

function assertSameTargets(actual: MoundPoses, expected: MoundPoses) {
  assert.equal(actual.size, expected.size)
  for (const [id, pose] of expected) {
    assert.deepEqual(
      actual.get(id)?.position,
      pose.position,
      `${id}: saved position`
    )
    assert.deepEqual(
      actual.get(id)?.rotation,
      pose.rotation,
      `${id}: complete saved rotation`
    )
  }
}

function assertRestored(sim: Simulation, initial: MoundPoses) {
  assert.equal(sim.entries.length, 86)
  let positionErrorSquared = 0
  let rotationErrorSquared = 0
  for (const { id, body, guide } of sim.entries) {
    const expected = initial.get(id)!
    const point = body.translation()
    const rotation = body.rotation()
    const error = new THREE.Quaternion(
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w
    ).angleTo(
      new THREE.Quaternion(
        expected.rotation.x,
        expected.rotation.y,
        expected.rotation.z,
        expected.rotation.w
      )
    )
    positionErrorSquared += new THREE.Vector3(
      point.x,
      point.y,
      point.z
    ).distanceToSquared(expected.position)
    rotationErrorSquared += error ** 2
    assert.equal(guide, undefined, `${id}: Free rearrangement must finish`)
    assert.equal(body.isDynamic(), true, `${id}: gravity must regain control`)
    assert.equal(body.collider(0).isEnabled(), true)
    assert.ok(
      point.y > 0 && Math.abs(point.x) < 5 && Math.abs(point.z) < 3.18,
      `${id}: restoring the mound must retain every book on the table`
    )
    const velocity = body.linvel()
    assert.ok(
      Math.hypot(velocity.x, velocity.y, velocity.z) < 0.03,
      `${id}: the restored book must settle`
    )
  }
  const positionRms = Math.sqrt(positionErrorSquared / sim.entries.length)
  const rotationRms = Math.sqrt(rotationErrorSquared / sim.entries.length)
  assert.ok(
    positionRms < 0.05,
    `Saved-pose return drifted ${positionRms.toFixed(3)} world units RMS`
  )
  assert.ok(
    rotationRms < (3 * Math.PI) / 180,
    `Saved-pose rotation drifted ${((rotationRms * 180) / Math.PI).toFixed(2)} degrees RMS`
  )
  assertNaturalOrientation(snapshot(sim), initial)
  return { positionRms, rotationRmsDegrees: (rotationRms * 180) / Math.PI }
}

function assertGrouped(
  sim: Awaited<ReturnType<typeof setup>>,
  arrangement: Arrangement
) {
  assert.equal(sim.entries.length, 86)
  assert.equal(arrangement.targets.size, 86)
  for (const entry of sim.entries) {
    const point = entry.body.translation()
    const destination = arrangement.targets.get(entry.id)!.position
    assert.equal(entry.guide, undefined, `${entry.id}: spell should finish`)
    assert.equal(
      entry.body.isDynamic(),
      true,
      `${entry.id}: gravity must regain control`
    )
    assert.equal(entry.body.collider(0).isEnabled(), true)
    assert.ok(
      Math.hypot(point.x - destination.x, point.z - destination.z) < 0.22,
      `${entry.id}: book missed its own pile`
    )
    assert.ok(
      point.y > 0 && Math.abs(point.x) < 4.65 && Math.abs(point.z) < 2.9,
      `${entry.id}: book left the tabletop`
    )
    const velocity = entry.body.linvel()
    assert.ok(
      Math.hypot(velocity.x, velocity.y, velocity.z) < 0.025,
      `${entry.id}: book did not settle`
    )
  }
}

await test('all 86 books regroup from a physical heap and remain in their assigned piles', async (t) => {
  const sim = await setup(t)
  sim.advance(12)
  for (const grouping of ['genre', 'author', 'published'] as const) {
    const arrangement = await sim.arrange(grouping)
    sim.advance(9)
    assertGrouped(sim, arrangement)
  }
})

await test('a grouping can interrupt another spell, and replay can begin above the frame', async (t) => {
  const sim = await setup(t)
  await sim.arrange('genre')
  sim.advance(0.7)
  const interrupted = await sim.arrange('published')
  sim.advance(10)
  assertGrouped(sim, interrupted)
})

await test('returning to Free restores the initial poses and natural orientations through repeated grouping', async (t) => {
  const sim = await setup(t)
  sim.advance(12)
  const initial = snapshot(sim)
  const remembered = await sim.memory.remember(sim.entries, true)
  assertSameTargets(remembered, initial)
  const results = []
  for (let cycle = 0; cycle < 2; cycle++) {
    await sim.arrange('author')
    sim.advance(10)
    const afterGrouping = await sim.memory.remember(sim.entries, true)
    assertSameTargets(afterGrouping, initial)
    const arrangement = await sim.arrange('free')
    assertSameTargets(arrangement.targets, initial)
    sim.advance(12)
    results.push(assertRestored(sim, initial))
  }
  t.diagnostic(
    JSON.stringify({ initial: naturalOrientation(initial), returns: results })
  )
})

await test('Free returns above every saved pose and falls gently into the natural mound', async (t) => {
  const sim = await setup(t)
  sim.advance(12)
  const initial = snapshot(sim)
  await sim.arrange('author')
  sim.advance(10)
  const starts = new Map(
    sim.entries.map(({ id, body }) => [id, body.translation().y])
  )
  const arrangement = await sim.arrange('free')
  assertSameTargets(arrangement.targets, initial)
  const guided = new Set<string>()
  const released = new Map<
    string,
    {
      verticalSpeed: number
      height: number
      clearance: number
      steps: number
      fall: number
    }
  >()
  let maximumLiftExcess = -Infinity
  sim.advance(8, {
    afterStep: () => {
      for (const { id, body, guide } of sim.entries) {
        const release = released.get(id)
        if (release && release.steps < 12) {
          release.steps++
          release.fall = Math.max(
            release.fall,
            release.height - body.translation().y
          )
        }
        if (!guide || !body.isKinematic()) continue
        guided.add(id)
        const ceiling = Math.max(
          starts.get(id)!,
          arrangement.targets.get(id)!.position.y
        )
        maximumLiftExcess = Math.max(
          maximumLiftExcess,
          body.translation().y - ceiling
        )
      }
    },
    onRelease: (id, verticalSpeed) => {
      const height = sim.entries
        .find((entry) => entry.id === id)!
        .body.translation().y
      released.set(id, {
        verticalSpeed,
        height,
        clearance: height - initial.get(id)!.position.y,
        steps: 0,
        fall: 0
      })
    }
  })
  const releases = [...released.values()]
  const maximumReleaseSpeed = Math.max(
    ...releases.map(({ verticalSpeed }) => Math.abs(verticalSpeed))
  )
  const minimumClearance = Math.min(
    ...releases.map(({ clearance }) => clearance)
  )
  const maximumClearance = Math.max(
    ...releases.map(({ clearance }) => clearance)
  )
  const minimumFall = Math.min(...releases.map(({ fall }) => fall))
  assert.equal(guided.size, 86, 'Every book must join the local rearrangement')
  assert.equal(released.size, 86, 'Every book must return to dynamic physics')
  assert.ok(
    maximumLiftExcess <= 0.4001,
    `Free lifted a book ${maximumLiftExcess.toFixed(3)} above its start or destination`
  )
  assert.ok(
    maximumReleaseSpeed < 1e-6,
    `Free launched books with vertical speed ${maximumReleaseSpeed.toFixed(3)}`
  )
  assert.ok(
    minimumClearance > 0.03 && maximumClearance <= 0.16,
    `Free must release just above the saved mound; clearances were ${minimumClearance.toFixed(3)}–${maximumClearance.toFixed(3)}`
  )
  assert.ok(
    maximumClearance - minimumClearance < 1e-5,
    'Release must lift the complete contact arrangement by one shared offset'
  )
  assert.ok(
    minimumFall > 0.01,
    `Every book must visibly fall after release; the smallest fall in 0.1 seconds was ${minimumFall.toFixed(3)}`
  )
  const restored = assertRestored(sim, initial)
  t.diagnostic(
    JSON.stringify({
      maximumLiftExcess,
      maximumReleaseSpeed,
      minimumClearance,
      maximumClearance,
      minimumFall,
      ...restored
    })
  )
})

await test('early grouping prepares one natural mound asynchronously without moving the live books', async (t) => {
  const sim = await setup(t)
  const before = snapshot(sim)
  let completed = false
  const pending = sim.memory.remember(sim.entries, true)
  assert.equal(
    sim.memory.remember(sim.entries, false),
    pending,
    'Concurrent requests must share the same preparation'
  )
  void pending.then(
    () => {
      completed = true
    },
    () => {
      completed = true
    }
  )
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  assert.equal(
    completed,
    false,
    'Natural-pile simulation must yield to the event loop'
  )
  const saved = await pending
  assertSameTargets(snapshot(sim), before)
  assert.ok(
    sim.entries.every(({ body }) => !body.isEnabled()),
    'Fallback preparation must leave offscreen live bodies inactive'
  )
  sim.advance(12)
  const naturalInitial = snapshot(sim)
  assertSameTargets(saved, naturalInitial)
  assertNaturalOrientation(saved, naturalInitial)
  await sim.arrange('author')
  sim.advance(10)
  assertSameTargets(await sim.memory.remember(sim.entries, true), saved)
  const arrangement = await sim.arrange('free')
  assertSameTargets(arrangement.targets, saved)
  sim.advance(12)
  assertRestored(sim, naturalInitial)
})

await test('Free requires a complete remembered mound instead of inventing a flat layout', async (t) => {
  const sim = await setup(t)
  const groups = buildPileGroups(books, 'free')
  assert.throws(
    () => makePileArrangement(sim.entries, groups, 'free'),
    /Remember the natural pile/
  )
  const incomplete = new Map(snapshot(sim))
  incomplete.delete(sim.entries[0]!.id)
  assert.throws(
    () =>
      makePileArrangement(
        sim.entries,
        groups,
        'free',
        new Map(
          [...incomplete].map(([id, pose]) => [id, { ...pose, delayMs: 0 }])
        )
      ),
    /missing book/
  )
})
