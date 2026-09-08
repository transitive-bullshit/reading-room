import type { PileTarget } from './physics-rearrange'
import {
  applyPileBounds,
  makeBookBody,
  makeWorld,
  PHYSICS_STEP,
  type BookBody,
  type BookDimensions,
  type Physics
} from './physics-world'

export interface MoundSeed {
  id: string
  dimensions: BookDimensions
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number; w: number }
  delayMs: number
}

interface MoundBook {
  id: string
  body: BookBody
}

export interface MoundMemory {
  remember: (
    liveBooks: readonly MoundBook[],
    canCapture: boolean
  ) => Promise<ReadonlyMap<string, PileTarget>>
  dispose: () => void
}

const SETTLE_SECONDS = 12
const SLICE_MS = 4

function snapshot(
  books: readonly MoundBook[]
): ReadonlyMap<string, PileTarget> {
  return new Map(
    books.map(({ id, body }) => [
      id,
      {
        position: { ...body.translation() },
        rotation: { ...body.rotation() },
        delayMs: 0
      }
    ])
  )
}

function isSettled(body: BookBody) {
  if (!body.isEnabled() || !body.isDynamic() || !body.collider(0).isEnabled())
    return false
  const linear = body.linvel()
  const angular = body.angvel()
  return (
    Math.hypot(linear.x, linear.y, linear.z) < 0.05 &&
    Math.hypot(angular.x, angular.y, angular.z) < 0.08
  )
}

function cancelled() {
  return new DOMException('Pile pose preparation was cancelled', 'AbortError')
}

/** Keep the first natural heap, including its tilted books and contact surfaces. */
export function createMoundMemory(
  physics: Physics,
  seeds: readonly MoundSeed[],
  limitX: number
): MoundMemory {
  const initialBooks = seeds.map((seed) => ({
    ...seed,
    dimensions: { ...seed.dimensions },
    position: { ...seed.position },
    rotation: { ...seed.rotation }
  }))
  let remembered: Promise<ReadonlyMap<string, PileTarget>> | undefined
  let disposed = false

  async function simulate() {
    if (disposed) throw cancelled()
    const world = makeWorld(physics)
    try {
      let deadline = performance.now() + SLICE_MS
      const yieldSlice = async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        if (disposed) throw cancelled()
        deadline = performance.now() + SLICE_MS
      }
      const books: (MoundSeed & { body: BookBody; active: boolean })[] = []
      for (const seed of initialBooks) {
        const body = makeBookBody(
          physics,
          world,
          seed.dimensions,
          seed.position
        )
        body.setRotation(seed.rotation, true)
        body.setEnabled(false)
        books.push({ ...seed, body, active: false })
        if (performance.now() >= deadline) await yieldSlice()
      }
      let time = 0
      for (
        let step = 0;
        step < Math.ceil(SETTLE_SECONDS / PHYSICS_STEP);
        step++
      ) {
        time += PHYSICS_STEP
        for (const book of books) {
          if (!book.active && time >= 0.08 + book.delayMs / 1000) {
            book.active = true
            book.body.setEnabled(true)
            book.body.setLinvel({ x: 0, y: -12, z: 0 }, true)
          }
          if (!book.active) continue
          book.body.resetForces(false)
          book.body.resetTorques(false)
          applyPileBounds(book.body, book.dimensions, limitX)
        }
        world.step()
        if (performance.now() >= deadline) await yieldSlice()
      }
      if (disposed) throw cancelled()
      return snapshot(books)
    } finally {
      world.free()
    }
  }

  return {
    remember(liveBooks, canCapture) {
      if (remembered) return remembered
      if (disposed) return (remembered = Promise.reject(cancelled()))
      const liveById = new Map(liveBooks.map((book) => [book.id, book]))
      const complete =
        liveBooks.length === initialBooks.length &&
        liveById.size === initialBooks.length &&
        initialBooks.every((seed) => liveById.has(seed.id))
      // This synchronous snapshot sees every body at the same simulation step.
      remembered =
        canCapture && complete && liveBooks.every(({ body }) => isSettled(body))
          ? Promise.resolve(snapshot(liveBooks))
          : simulate()
      return remembered
    },
    dispose() {
      disposed = true
    }
  }
}
