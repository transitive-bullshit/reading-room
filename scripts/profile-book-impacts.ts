// Run: pnpm exec tsx scripts/profile-book-impacts.ts [/tmp/book-impact-traces.json]
// Uses production physics/contact filtering; only the deterministic pointer path
// and six per-grab roll choices substitute for live browser input.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'

import type { LibraryData } from '../lib/library-schema'
import type { BookImpact } from '../app/prototypes/reading-room/room-audio'
import {
  alignCamera,
  makeCamera,
  offscreenDropPosition
} from '../app/prototypes/reading-room/variants/physics-camera'
import {
  applyBookDrag,
  createDragTarget,
  updateDragTarget
} from '../app/prototypes/reading-room/variants/physics-drag'
import { applyHeldBookTorque } from '../app/prototypes/reading-room/variants/physics-held'
import { createBookImpacts } from '../app/prototypes/reading-room/variants/physics-impacts'
import { getPileDrop } from '../app/prototypes/reading-room/variants/physics-pile'
import { createMoundMemory } from '../app/prototypes/reading-room/variants/physics-mound'
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
  bookDimensions,
  loadPhysics,
  makeBookBody,
  makeWorld,
  PHYSICS_STEP
} from '../app/prototypes/reading-room/variants/physics-world'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const library = JSON.parse(read('data/library.json')) as LibraryData
const aspects = JSON.parse(read('data/cover-aspects.json')) as Record<
  string,
  number
>
// Read the actual display order rather than maintaining a duplicate list.
const displaySource = read('app/prototypes/reading-room/reading-room.tsx')
const displayBlock = displaySource.match(
  /const displayIds = \[([\s\S]*?)\]/
)?.[1]
if (!displayBlock) throw new Error('Cannot find the live displayIds list')
const displayIds = [...displayBlock.matchAll(/'([^']+)'/g)].map(
  (match) => match[1]!
)
const books = [
  ...displayIds.map((id) => {
    const book = library.books.find((item) => item.id === id)
    if (!book) throw new Error(`Missing display book ${id}`)
    return book
  }),
  ...library.books.filter(
    (book) => book.personal.rating === 5 && !displayIds.includes(book.id)
  )
]
const physics = await loadPhysics()
type Point = { x: number; y: number; z: number }
type Event = BookImpact & { timeMs: number }
type Action = {
  timeMs: number
  action: 'grab' | 'release' | 'arrange'
  bookId?: string
  title?: string
  position?: Point
  velocity?: Point
  dragHeight?: number
  visibleBooks?: number
  grouping?: PileGrouping
}

function simulation(count: number) {
  const world = makeWorld(physics)
  const impacts = createBookImpacts(physics, world)
  const camera = makeCamera()
  alignCamera(camera)
  const entries = books.slice(0, count).map((book, index) => {
    const aspect = aspects[book.id]
    if (!aspect) throw new Error(`Missing live cover aspect ${book.id}`)
    const dimensions = bookDimensions(aspect, book.pageCount ?? 350)
    const drop = getPileDrop(index, count, false, dimensions)
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
    impacts.track(body)
    body.setRotation(rotation, true)
    body.setEnabled(false)
    return {
      id: book.id,
      book,
      dimensions,
      body,
      start: 80 + drop.delayMs,
      home: {
        x: drop.position.x,
        y: dimensions.height / 2 + 0.4,
        z: drop.position.z
      },
      initialPosition: { x: position.x, y: position.y, z: position.z },
      initialRotation: { ...drop.rotation },
      active: false,
      guide: undefined as BookRearrangement | undefined
    }
  })
  type Entry = (typeof entries)[number]
  const moundMemory = createMoundMemory(
    physics,
    entries.map((entry) => ({
      id: entry.id,
      dimensions: entry.dimensions,
      position: entry.initialPosition,
      rotation: entry.initialRotation,
      delayMs: entry.start - 80
    })),
    3.85
  )
  let held:
    | {
        entry: Entry
        target: ReturnType<typeof createDragTarget>
        orientation: THREE.Quaternion
        start: Point
      }
    | undefined
  let frame = 0
  let time = 0
  let previousMs = 0
  let accumulator = 0
  let resets = 0
  const used = new Set<string>()
  const events: Event[] = []
  const actions: Action[] = []
  const clamp = THREE.MathUtils.clamp

  function visible(entry: Entry) {
    const center = entry.body.translation()
    const quaternion = entry.body.rotation()
    const rotation = new THREE.Quaternion(
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w
    )
    for (const x of [-0.3, 0, 0.3]) {
      for (const z of [-0.3, 0, 0.3]) {
        const point = new THREE.Vector3(
          x * entry.dimensions.width,
          entry.dimensions.height / 2,
          z * entry.dimensions.depth
        )
          .applyQuaternion(rotation)
          .add(new THREE.Vector3(center.x, center.y, center.z))
        const projected = point.clone().project(camera)
        if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) continue
        const direction = point.sub(camera.position).normalize()
        const hit = world.castRay(
          new physics.Ray(camera.position, direction),
          100,
          true
        )
        if (hit?.collider.parent()?.handle === entry.body.handle) return true
      }
    }
    return false
  }

  return {
    entries,
    events,
    actions,
    get nowMs() {
      return previousMs
    },
    get resets() {
      return resets
    },
    advance(
      seconds: number,
      pointer?: (frameInSegment: number, secondsInSegment: number) => void
    ) {
      for (let index = 0; index < Math.round(seconds * 60); index++) {
        const now = (++frame * 1000) / 60
        pointer?.(index, index / 60)
        accumulator = Math.min(0.1, accumulator + (now - previousMs) / 1000)
        previousMs = now
        while (accumulator >= PHYSICS_STEP) {
          time += PHYSICS_STEP
          const transitionTime = now - accumulator * 1000 + PHYSICS_STEP * 1000
          for (const entry of entries) {
            const { body, dimensions } = entry
            if (!entry.active && transitionTime >= entry.start) {
              entry.active = true
              body.setEnabled(true)
              body.setLinvel({ x: 0, y: -12, z: 0 }, true)
              body.wakeUp()
            }
            if (entry.guide) {
              if (applyBookRearrangement(body, entry.guide, time)) continue
              entry.guide = undefined
            }
            if (!entry.active || !body.isDynamic()) continue
            body.resetForces(false)
            body.resetTorques(false)
            if (held?.entry === entry)
              applyHeldBookTorque(body, held.orientation)
            const point = body.translation()
            const velocity = body.linvel()
            const excessX = Math.max(0, Math.abs(point.x) - 3.85)
            const excessZ = Math.max(0, Math.abs(point.z) - 2.13)
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
            if (held?.entry === entry)
              applyBookDrag(body, held.target, now / 1000 - accumulator)
          }
          impacts.beforeStep()
          world.step(impacts.queue)
          impacts.afterStep()
          accumulator -= PHYSICS_STEP
        }
        impacts.flush(now, (impact) => events.push({ ...impact, timeMs: now }))
        for (const entry of entries) {
          if (entry.active && entry.body.translation().y < -3) {
            resets++
            entry.body.setTranslation(entry.home, true)
            entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
            entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
          }
        }
      }
    },
    grab(index: number) {
      void moundMemory.remember(
        entries,
        entries.every((entry) => entry.active && !entry.guide)
      )
      const visibleEntries = entries
        .filter((entry) => !used.has(entry.id) && visible(entry))
        .sort((a, b) => b.body.translation().y - a.body.translation().y)
      const rank = [0, 0.35, 0.65, 0.2, 0.8, 0.45][index]!
      const entry =
        visibleEntries[
          Math.floor(rank * Math.max(0, visibleEntries.length - 1))
        ]
      if (!entry) throw new Error(`No visible unused book for grab ${index}`)
      used.add(entry.id)
      const center = entry.body.translation()
      const turnClearance =
        Math.hypot(entry.dimensions.width, entry.dimensions.depth) / 2 +
        entry.dimensions.height / 2 +
        0.08
      const dragHeight = Math.max(center.y + 0.12, turnClearance)
      const start = { x: center.x, y: dragHeight, z: center.z }
      entry.body.resetForces(true)
      entry.body.resetTorques(true)
      entry.body.wakeUp()
      for (const other of entries) {
        const point = other.body.translation()
        if (Math.hypot(point.x - center.x, point.z - center.z) < 2.3)
          other.body.wakeUp()
      }
      held = {
        entry,
        start,
        target: createDragTarget(start, (frame * 1000) / 60 / 1000),
        orientation: camera.quaternion
          .clone()
          .multiply(
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 0, 1),
              THREE.MathUtils.degToRad([-12, 8, -4, 14, -9, 3][index]!)
            )
          )
          .multiply(
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(1, 0, 0),
              Math.PI / 2
            )
          )
      }
      actions.push({
        timeMs: (frame * 1000) / 60,
        action: 'grab',
        bookId: entry.id,
        title: entry.book.title,
        position: { ...center },
        dragHeight,
        visibleBooks: visibleEntries.length
      })
    },
    move(index: number, elapsed: number) {
      if (!held) return
      // One crossing, a direction change, then a second diagonal sweep at a
      // constant live drag-plane height. End with motion for a physical release.
      const direction = index % 2 ? -1 : 1
      const waypoints = [
        held.start,
        { x: direction * 2.8, y: held.start.y, z: -1.45 },
        { x: -direction * 2.6, y: held.start.y, z: 1.15 },
        { x: direction * 1.3, y: held.start.y, z: -0.3 }
      ]
      const segment = Math.min(2, Math.floor(elapsed / 0.7))
      const fraction = clamp((elapsed - segment * 0.7) / 0.7, 0, 1)
      const from = waypoints[segment]!,
        to = waypoints[segment + 1]!
      updateDragTarget(
        held.target,
        {
          x: clamp(THREE.MathUtils.lerp(from.x, to.x, fraction), -4.18, 4.18),
          y: held.start.y,
          z: clamp(THREE.MathUtils.lerp(from.z, to.z, fraction), -2.15, 2.15)
        },
        frame / 60
      )
    },
    release() {
      if (!held) return
      const { body } = held.entry
      body.resetForces(true)
      const velocity = body.linvel()
      const limited = new THREE.Vector3(
        velocity.x,
        velocity.y,
        velocity.z
      ).clampLength(0, 3.2)
      body.setLinvel(limited, true)
      actions.push({
        timeMs: (frame * 1000) / 60,
        action: 'release',
        bookId: held.entry.id,
        position: { ...body.translation() },
        velocity: { x: limited.x, y: limited.y, z: limited.z }
      })
      held = undefined
    },
    async arrange(grouping: PileGrouping) {
      const remembered = await moundMemory.remember(
        entries,
        !held && entries.every((entry) => entry.active && !entry.guide)
      )
      const arrangement = makePileArrangement(
        entries,
        buildPileGroups(
          entries.map((entry) => entry.book),
          grouping
        ),
        grouping,
        remembered
      )
      for (const entry of entries)
        entry.guide = createBookRearrangement(
          entry.body,
          arrangement.targets.get(entry.id)!,
          time
        )
      actions.push({ timeMs: (frame * 1000) / 60, action: 'arrange', grouping })
    },
    dispose() {
      moundMemory.dispose()
      impacts.dispose()
      world.free()
    }
  }
}

function summary(events: Event[], durationMs: number) {
  const strengths = events.map((event) => event.strength).sort((a, b) => a - b)
  const quantile = (fraction: number) =>
    strengths[Math.floor((strengths.length - 1) * fraction)] ?? 0
  const peak = (windowMs: number) => {
    let left = 0,
      max = 0
    for (let right = 0; right < events.length; right++) {
      while (events[right]!.timeMs - events[left]!.timeMs >= windowMs) left++
      max = Math.max(max, right - left + 1)
    }
    return max
  }
  return {
    count: events.length,
    table: events.filter((event) => event.kind === 'table').length,
    book: events.filter((event) => event.kind === 'book').length,
    firstMs: events[0]?.timeMs ?? null,
    lastMs: events.at(-1)?.timeMs ?? null,
    perSecondOverall: events.length / (durationMs / 1000),
    peakEvents100ms: peak(100),
    peakEvents250ms: peak(250),
    peakEvents1s: peak(1000),
    strength: {
      minimum: quantile(0),
      median: quantile(0.5),
      p90: quantile(0.9),
      maximum: quantile(1)
    }
  }
}

const trackedSources = [
  'physics-world',
  'physics-camera',
  'physics-pile',
  'physics-drag',
  'physics-held',
  'physics-impacts',
  'physics-rearrange'
].map((name) => `app/prototypes/reading-room/variants/${name}.ts`)
const output = {
  generatedAt: new Date().toISOString(),
  script: fileURLToPath(import.meta.url),
  command:
    'pnpm exec tsx scripts/profile-book-impacts.ts /tmp/book-impact-traces.json',
  environment: {
    renderHz: 60,
    physicsHz: 120,
    viewport: [1600, 900],
    mobile: false,
    reducedMotion: false
  },
  method:
    'Production Rapier world/body/drops/impacts/drag/held helpers; production 60Hz accumulator order, boundary forces, turn clearance, 3.2 release clamp and off-table recovery. Pointers sampled at60Hz; visible books selected by camera-to-cover rays against actual colliders. No fabricated collision events.',
  sourceHashes: Object.fromEntries(
    trackedSources.map((path) => [
      path,
      createHash('sha256').update(read(path)).digest('hex')
    ])
  ),
  scenarios: [] as {
    id: string
    bookCount: number
    durationMs: number
    simulationStartMs: number
    offTableRecoveries: number
    summary: ReturnType<typeof summary>
    events: Event[]
    actions: Action[]
    bookIds: string[]
  }[]
}
const path = process.argv[2] ?? '/tmp/book-impact-traces.json'
function save(
  sim: ReturnType<typeof simulation>,
  id: string,
  start: number,
  durationMs: number,
  eventStart: number,
  actionStart: number,
  resetsStart: number
) {
  const events = sim.events
    .slice(eventStart)
    .map((event) => ({ ...event, timeMs: event.timeMs - start }))
  const scenario = {
    id,
    bookCount: sim.entries.length,
    durationMs,
    simulationStartMs: start,
    offTableRecoveries: sim.resets - resetsStart,
    summary: summary(events, durationMs),
    events,
    actions: sim.actions
      .slice(actionStart)
      .map((action) => ({ ...action, timeMs: action.timeMs - start })),
    bookIds: sim.entries.map((entry) => entry.id)
  }
  output.scenarios.push(scenario)
  writeFileSync(path, JSON.stringify(output, null, 2) + '\n')
  console.log(
    JSON.stringify({
      id,
      ...scenario.summary,
      offTableRecoveries: scenario.offTableRecoveries
    })
  )
}

const simulations = [simulation(25), simulation(books.length)]
try {
  for (const sim of simulations) {
    sim.advance(12)
    save(
      sim,
      `${sim.entries.length === 25 ? 'the-pile-25' : 'big-pile-86'}-initial-drop`,
      0,
      12_000,
      0,
      0,
      0
    )
  }
  for (const sim of simulations) {
    const start = sim.nowMs,
      eventStart = sim.events.length,
      actionStart = sim.actions.length,
      resets = sim.resets
    sim.advance(18, (frame, elapsed) => {
      const grab = Math.floor(elapsed / 3)
      const frameInGrab = frame % 180
      if (frameInGrab === 0) sim.grab(grab)
      if (frameInGrab < 126) sim.move(grab, frameInGrab / 60)
      if (frameInGrab === 126) sim.release()
    })
    save(
      sim,
      `${sim.entries.length === 25 ? 'the-pile-25' : 'big-pile-86'}-six-drags`,
      start,
      18_000,
      eventStart,
      actionStart,
      resets
    )
  }
} finally {
  simulations.forEach((sim) => sim.dispose())
}
console.log(`Saved ${output.scenarios.length} scenarios to ${path}`)
