import { RigidBodyType } from '@dimforge/rapier3d-compat'
import { Quaternion } from 'three'

import type { HeldBookRotation } from './physics-held'
import type { PileGroup, PileGrouping } from './pile-groups'
import type { BookBody, BookDimensions } from './physics-world'

interface Vector {
  x: number
  y: number
  z: number
}

export interface RearrangeBook {
  id: string
  body: BookBody
  dimensions: BookDimensions
}

export interface PileTarget {
  position: Vector
  rotation: HeldBookRotation
  delayMs: number
  mound?: boolean
}

export interface PileLabel {
  id: string
  label: string
  count: number
  position: Vector
}

export interface BookRearrangement {
  start: number
  from: Vector
  velocity: Vector
  lift: Vector
  glide: Vector
  target: Vector
  rotation: HeldBookRotation
  fromRotation: HeldBookRotation
  liftSeconds: number
  durationScale: number
  mound: boolean
}

const LIFT_SECONDS = 0.46
const GLIDE_SECONDS = 0.92
const LOWER_SECONDS = 0.55
const SETTLE_SECONDS = 0.3
const MOUND_SECONDS = 1.8
const MOUND_SETTLE_SECONDS = 0.12
const MOUND_RELEASE_HEIGHT = 0.12
const currentRotation = new Quaternion()
const targetRotation = new Quaternion()

function variation(id: string) {
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return ((hash >>> 0) % 1000) / 999 - 0.5
}

/** Destinations only: this never changes a body's pose or disables contact. */
export function makePileArrangement(
  books: RearrangeBook[],
  groups: PileGroup[],
  grouping: PileGrouping,
  moundTargets?: ReadonlyMap<string, PileTarget>
) {
  const targets = new Map<string, PileTarget>()
  const labels: PileLabel[] = []
  const byId = new Map(books.map((book) => [book.id, book]))
  if (grouping === 'free') {
    if (!moundTargets)
      throw new Error('Remember the natural pile before arranging Free')
    for (const book of books) {
      const destination = moundTargets.get(book.id)
      if (!destination)
        throw new Error('The remembered pile is missing book ' + book.id)
      targets.set(book.id, {
        position: { ...destination.position },
        rotation: { ...destination.rotation },
        delayMs: destination.delayMs,
        mound: true
      })
    }
    return { targets, labels }
  }
  const rows = groups.length > 3 ? 2 : 1
  const columns = Math.ceil(groups.length / rows)
  groups.forEach((group, groupIndex) => {
    // Publication uses vertical pairs: both left piles precede the middle pair,
    // which precedes the right pair. Other modes read across each table row.
    const column =
      grouping === 'published'
        ? Math.floor(groupIndex / rows)
        : groupIndex % columns
    const row =
      grouping === 'published'
        ? groupIndex % rows
        : Math.floor(groupIndex / columns)
    const center = {
      x: (column - (columns - 1) / 2) * 3.05,
      z: rows === 1 ? 0 : row === 0 ? -1.32 : 1.32
    }
    const members = group.books
      .map((book) => byId.get(book.id))
      .filter((book): book is RearrangeBook => Boolean(book))
      .sort((a, b) => {
        // A square audiobook cover makes a stable bridge above both stacks.
        const wide =
          Number(a.dimensions.width > 1.5) - Number(b.dimensions.width > 1.5)
        return wide || b.body.translation().y - a.body.translation().y
      })
    const heights = [0.008, 0.008]
    const twoStacks = members.length > 8
    const laneOffset =
      Math.max(
        1.4,
        ...members
          .filter((book) => book.dimensions.width <= 1.5)
          .map((book) => {
            const yaw = Math.abs(variation(book.id) * 0.04)
            return (
              book.dimensions.width * Math.cos(yaw) +
              book.dimensions.depth * Math.sin(yaw) +
              0.035
            )
          })
      ) / 2
    members.forEach((book, index) => {
      const lane = heights[0]! <= heights[1]! ? 0 : 1
      const bridge = book.dimensions.width > 1.5
      const base = bridge ? Math.max(...heights) : heights[lane]!
      const yaw = variation(book.id) * 0.04
      targets.set(book.id, {
        position: {
          x:
            center.x +
            (twoStacks && !bridge
              ? lane === 0
                ? -laneOffset
                : laneOffset
              : 0),
          y: base + book.dimensions.height / 2,
          z: center.z + variation(book.id) * 0.055
        },
        rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
        delayMs: index * 18 + groupIndex * 20
      })
      const next = base + book.dimensions.height + 0.004
      if (bridge || !twoStacks) heights.fill(next)
      else heights[lane] = next
    })
    labels.push({
      id: group.id,
      label: group.label,
      count: members.length,
      position: {
        x: center.x,
        y: rows === 2 && row === 0 ? Math.max(...heights) + 0.18 : 0.01,
        z: center.z + (rows === 2 && row === 0 ? -1.08 : 1.13)
      }
    })
  })
  return { targets, labels }
}

/** Capture the live pose and velocity so a second grouping can interrupt freely. */
export function createBookRearrangement(
  body: BookBody,
  destination: PileTarget,
  now: number,
  reducedMotion = false
): BookRearrangement {
  const from = { ...body.translation() }
  const interrupted = body.isKinematic()
  const velocity = { ...body.linvel() }
  const fromRotation = { ...body.rotation() }
  const mound = destination.mound === true
  const target = {
    ...destination.position,
    // Preserve the whole mound's contact arrangement, then let gravity give it
    // a small final settle after the guide releases every book together.
    y: destination.position.y + (mound ? MOUND_RELEASE_HEIGHT : 0.055)
  }
  const liftHeight = Math.max(
    from.y +
      (mound || interrupted || from.y > 4 ? 0 : reducedMotion ? 0.16 : 0.8),
    target.y + (mound ? 0 : reducedMotion ? 0.18 : 0.8)
  )
  body.resetForces(true)
  body.resetTorques(true)
  body.setBodyType(RigidBodyType.KinematicPositionBased, true)
  return {
    // The low mound arrives together, so no moving collider sweeps through
    // books that have already been released into the new foundation.
    start:
      now +
      (!mound && !reducedMotion && !interrupted
        ? destination.delayMs / 1000
        : 0),
    from,
    velocity,
    lift: {
      x: from.x,
      y: liftHeight,
      z: from.z
    },
    glide: { x: target.x, y: liftHeight, z: target.z },
    target,
    rotation: destination.rotation,
    fromRotation,
    liftSeconds: interrupted ? 0.16 : LIFT_SECONDS,
    durationScale: reducedMotion ? 1.2 : 1,
    mound
  }
}

function sampleSegment(
  from: Vector,
  to: Vector,
  initialVelocity: Vector,
  elapsed: number,
  duration: number
) {
  const t = Math.max(0, Math.min(1, elapsed / duration))
  const position = { x: 0, y: 0, z: 0 }
  for (const axis of ['x', 'y', 'z'] as const) {
    const distance = to[axis] - from[axis]
    position[axis] =
      from[axis] +
      distance * t * t * (3 - 2 * t) +
      initialVelocity[axis] * duration * t * (1 - t) ** 2
  }
  return position
}

/** A reader can take over any moving book without keeping a scripted pose. */
export function cancelBookRearrangement(body: BookBody) {
  body.setBodyType(RigidBodyType.Dynamic, true)
  body.resetForces(true)
  body.resetTorques(true)
}

/** The spell guides a collider through the air, then releases a dynamic book. */
export function applyBookRearrangement(
  body: BookBody,
  guide: BookRearrangement,
  now: number
) {
  if (!body.isKinematic()) return false
  const elapsed = (now - guide.start) / guide.durationScale
  if (elapsed < 0) return true
  const liftSeconds = guide.liftSeconds
  if (guide.mound && elapsed >= MOUND_SECONDS + MOUND_SETTLE_SECONDS) {
    cancelBookRearrangement(body)
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    return false
  }
  if (elapsed >= liftSeconds + GLIDE_SECONDS + LOWER_SECONDS + SETTLE_SECONDS) {
    cancelBookRearrangement(body)
    return false
  }
  const zero = { x: 0, y: 0, z: 0 }
  let position
  if (guide.mound) {
    // Re-form close to the table instead of taking every book up to a shared
    // drop height. A shallow arc clears the old stack without a lift phase.
    const speed = Math.hypot(
      guide.velocity.x,
      guide.velocity.y,
      guide.velocity.z
    )
    const carry = Math.min(1, 0.7 / Math.max(0.001, speed))
    const velocity = {
      x: guide.velocity.x * carry,
      y: guide.velocity.y * carry,
      z: guide.velocity.z * carry
    }
    position = sampleSegment(
      guide.from,
      guide.target,
      velocity,
      elapsed * guide.durationScale,
      MOUND_SECONDS * guide.durationScale
    )
    const progress = Math.min(1, elapsed / MOUND_SECONDS)
    position.y += Math.sin(progress * Math.PI) ** 2 * 0.16
  } else if (elapsed < liftSeconds)
    position = sampleSegment(
      guide.from,
      guide.lift,
      guide.velocity,
      elapsed * guide.durationScale,
      liftSeconds * guide.durationScale
    )
  else if (elapsed < liftSeconds + GLIDE_SECONDS)
    position = sampleSegment(
      guide.lift,
      guide.glide,
      zero,
      (elapsed - liftSeconds) * guide.durationScale,
      GLIDE_SECONDS * guide.durationScale
    )
  else if (elapsed < liftSeconds + GLIDE_SECONDS + LOWER_SECONDS)
    position = sampleSegment(
      guide.glide,
      guide.target,
      zero,
      (elapsed - liftSeconds - GLIDE_SECONDS) * guide.durationScale,
      LOWER_SECONDS * guide.durationScale
    )
  else position = guide.target
  body.setNextKinematicTranslation(position)
  const progress = Math.min(
    1,
    elapsed / (guide.mound ? MOUND_SECONDS : liftSeconds + GLIDE_SECONDS + 0.25)
  )
  currentRotation.set(
    guide.fromRotation.x,
    guide.fromRotation.y,
    guide.fromRotation.z,
    guide.fromRotation.w
  )
  targetRotation.set(
    guide.rotation.x,
    guide.rotation.y,
    guide.rotation.z,
    guide.rotation.w
  )
  currentRotation.slerp(
    targetRotation,
    progress * progress * (3 - 2 * progress)
  )
  body.setNextKinematicRotation(currentRotation)
  return true
}
