import {
  TABLE_DEPTH,
  TABLE_WIDTH,
  type BookBody,
  type BookDimensions
} from './physics-world'

type Vector = { x: number; y: number; z: number }
type Rotation = Vector & { w: number }

export interface PileDrop {
  position: Vector
  rotation: Rotation
  delayMs: number
}

export interface PileBook {
  body: BookBody
  dimensions: BookDimensions
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

function variation(index: number, seed: number) {
  const value = Math.sin((index + 1) * 127.1 + seed * 311.7) * 43_758.5453
  return value - Math.floor(value)
}

function orientation(yaw: number, pitch: number, roll: number): Rotation {
  const cy = Math.cos(yaw / 2)
  const sy = Math.sin(yaw / 2)
  const cx = Math.cos(pitch / 2)
  const sx = Math.sin(pitch / 2)
  const cz = Math.cos(roll / 2)
  const sz = Math.sin(roll / 2)
  return {
    x: cy * sx * cz + sy * cx * sz,
    y: sy * cx * cz - cy * sx * sz,
    z: cy * cx * sz - sy * sx * cz,
    w: cy * cx * cz + sy * sx * sz
  }
}

/** Initial conditions only. Activate each dynamic body when its delay elapses. */
export function getPileDrop(
  index: number,
  count: number,
  mobile: boolean,
  dimensions: BookDimensions
): PileDrop {
  const order = Math.max(0, Math.floor(index))
  const total = Math.max(1, Math.floor(count))
  const large = total > 25
  // A sunflower footprint gives a broad, irregular foundation. Later books
  // return toward its middle to make a mound instead of 25 isolated objects.
  const angle = order * Math.PI * (3 - Math.sqrt(5)) + 0.35
  const radius = Math.sqrt((((order * 7) % total) + 0.55) / total)
  const lateTaper = order / total > 0.72 ? (large ? 0.9 : 0.75) : 1
  const footprint = mobile ? 0.9 : 1
  const yaw = (variation(order, 1) - 0.5) * 1.7
  const pitch = (variation(order, 2) - 0.5) * 0.4
  const roll = (variation(order, 3) - 0.5) * 0.36
  const halfDiagonal = Math.hypot(dimensions.width, dimensions.depth) / 2
  const reachX = Math.min(
    large ? 3.55 : 2.75,
    TABLE_WIDTH / 2 - halfDiagonal - (large ? 0.3 : 0.8)
  )
  const reachZ = Math.min(
    large ? 1.85 : 1.34,
    TABLE_DEPTH / 2 - halfDiagonal - (large ? 0.15 : 0.55)
  )
  return {
    position: {
      x: Math.cos(angle) * radius * reachX * lateTaper * footprint,
      y: 6.2 + variation(order, 4) * 1.25 + dimensions.height / 2,
      z: Math.sin(angle) * radius * reachZ * lateTaper
    },
    rotation: orientation(yaw, pitch, roll),
    delayMs: order * (large ? Math.min(24, 2000 / Math.max(1, total - 1)) : 40)
  }
}

function axes(q: Rotation) {
  return {
    right: {
      x: 1 - 2 * (q.y * q.y + q.z * q.z),
      y: 2 * (q.x * q.y + q.z * q.w),
      z: 2 * (q.x * q.z - q.y * q.w)
    },
    up: {
      x: 2 * (q.x * q.y - q.z * q.w),
      y: 1 - 2 * (q.x * q.x + q.z * q.z),
      z: 2 * (q.y * q.z + q.x * q.w)
    },
    forward: {
      x: 2 * (q.x * q.z + q.y * q.w),
      y: 2 * (q.y * q.z - q.x * q.w),
      z: 1 - 2 * (q.x * q.x + q.y * q.y)
    }
  }
}

function bounds(body: BookBody, dimensions?: BookDimensions) {
  const extents = body.collider(0).halfExtents()
  const half = dimensions
    ? {
        x: dimensions.width / 2,
        y: dimensions.height / 2,
        z: dimensions.depth / 2
      }
    : {
        x: (extents?.x ?? 0.6) + 0.012,
        y: (extents?.y ?? 0.08) + 0.012,
        z: (extents?.z ?? 0.95) + 0.012
      }
  const { right, up, forward } = axes(body.rotation())
  return {
    x:
      Math.abs(right.x) * half.x +
      Math.abs(up.x) * half.y +
      Math.abs(forward.x) * half.z,
    y:
      Math.abs(right.y) * half.x +
      Math.abs(up.y) * half.y +
      Math.abs(forward.y) * half.z,
    z:
      Math.abs(right.z) * half.x +
      Math.abs(up.z) * half.y +
      Math.abs(forward.z) * half.z
  }
}

/** One click impulse, never a per-frame force or a pose assignment. */
export function scatterAbove(selected: BookBody, others: PileBook[]) {
  const origin = selected.translation()
  const selectedBounds = bounds(selected)
  let scattered = 0
  const maxHeight = others.length > 25 ? 4.5 : 2.6
  for (const { body, dimensions } of others) {
    if (body.handle === selected.handle || !body.isDynamic()) continue
    const point = body.translation()
    const dy = point.y - origin.y
    if (dy <= Math.max(0.035, dimensions.height * 0.2) || dy > maxHeight)
      continue
    const extent = bounds(body, dimensions)
    const dx = point.x - origin.x
    const dz = point.z - origin.z
    const overlapX = selectedBounds.x + extent.x - Math.abs(dx)
    const overlapZ = selectedBounds.z + extent.z - Math.abs(dz)
    if (overlapX <= 0.035 || overlapZ <= 0.035) continue

    const overlap = clamp(
      Math.min(
        overlapX / (2 * Math.min(selectedBounds.x, extent.x)),
        overlapZ / (2 * Math.min(selectedBounds.z, extent.z))
      ),
      0,
      1
    )
    const weight = (0.45 + overlap * 0.55) / (1 + dy * 0.18)
    const fallback = variation(scattered, 9) * Math.PI * 2
    let outwardX = dx
    let outwardZ = dz
    if (Math.hypot(dx, dz) < 0.12) {
      outwardX = Math.cos(fallback)
      outwardZ = Math.sin(fallback)
    }
    // Redirect an edge-facing push toward the table before applying it. This
    // caps travel without arresting the body's existing collision velocity.
    if (Math.abs(point.x) + extent.x > TABLE_WIDTH / 2 - 1)
      outwardX = -Math.sign(point.x) * Math.max(0.45, Math.abs(outwardX))
    if (Math.abs(point.z) + extent.z > TABLE_DEPTH / 2 - 0.9)
      outwardZ = -Math.sign(point.z) * Math.max(0.45, Math.abs(outwardZ))
    const length = Math.max(0.001, Math.hypot(outwardX, outwardZ))
    outwardX /= length
    outwardZ /= length
    const mass = Math.max(0.05, body.mass())
    const speed = 0.9 + weight * 1.05
    body.applyImpulse(
      {
        x: outwardX * speed * mass,
        y: (1.1 + weight * 0.7) * mass,
        z: outwardZ * speed * mass
      },
      true
    )
    body.applyTorqueImpulse(
      {
        x: -outwardZ * 0.035 * mass,
        y: (variation(scattered, 10) - 0.5) * 0.12 * mass,
        z: outwardX * 0.035 * mass
      },
      true
    )
    scattered++
  }
  return scattered
}
