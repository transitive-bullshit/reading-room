import * as THREE from 'three'

import { TABLE_DEPTH, TABLE_WIDTH, type BookDimensions } from './physics-world'

type Point = [number, number]

function homography(from: Point[], to: Point[]) {
  const rows: number[][] = []
  for (let index = 0; index < 4; index++) {
    const [x, y] = from[index]!
    const [u, v] = to[index]!
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let column = 0; column < 8; column++) {
    let pivot = column
    for (let row = column + 1; row < 8; row++) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!))
        pivot = row
    }
    const pivotRow = rows[pivot]!
    rows[pivot] = rows[column]!
    rows[column] = pivotRow
    const divisor = rows[column]![column]!
    for (let cell = column; cell < 9; cell++) rows[column]![cell]! /= divisor
    for (let row = 0; row < 8; row++) {
      if (row === column) continue
      const multiplier = rows[row]![column]!
      for (let cell = column; cell < 9; cell++) {
        rows[row]![cell]! -= multiplier * rows[column]![cell]!
      }
    }
  }
  return rows.map((row) => row[8]!)
}

export function makeCamera() {
  const camera = new THREE.PerspectiveCamera(9.8, 1600 / 900, 8, 120)
  camera.position.set(-1.6, 28.5, 41)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  return camera
}

// The photograph has a slightly asymmetric perspective. This projective correction
// registers the real 3D table plane to its four photographed corners exactly.
export function alignCamera(
  camera: THREE.PerspectiveCamera,
  fit = 1,
  verticalFit = fit,
  centerY = 625
) {
  camera.updateProjectionMatrix()
  const projected = [
    [-TABLE_WIDTH / 2, -TABLE_DEPTH / 2],
    [TABLE_WIDTH / 2, -TABLE_DEPTH / 2],
    [TABLE_WIDTH / 2, TABLE_DEPTH / 2],
    [-TABLE_WIDTH / 2, TABLE_DEPTH / 2]
  ].map(([x, z]) => {
    const point = new THREE.Vector3(x!, 0, z!).project(camera)
    return [point.x, point.y] as Point
  })
  const desired = [
    [263, 405],
    [1260, 405],
    [1340, 787],
    [233, 775]
  ].map(([x, y]) => {
    const px = 800 + (x! - 800) * fit
    const py = centerY + (y! - 625) * verticalFit
    return [(px / 1600) * 2 - 1, 1 - (py / 900) * 2] as Point
  })
  const [a, b, c, d, e, f, g, h] = homography(projected, desired)
  camera.projectionMatrix.premultiply(
    new THREE.Matrix4().set(
      a!,
      b!,
      0,
      c!,
      d!,
      e!,
      0,
      f!,
      0,
      0,
      1,
      0,
      g!,
      h!,
      0,
      1
    )
  )
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
}

// Spawn beyond the full render frame, including the rotated page block. The
// image is cropped by the viewport, so clearing this edge also clears the crop.
export function offscreenDropPosition(
  camera: THREE.PerspectiveCamera,
  dimensions: BookDimensions,
  rotation: THREE.Quaternion,
  position: THREE.Vector3
) {
  const origin = position.clone()
  const corners: THREE.Vector3[] = []
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1])
        corners.push(
          new THREE.Vector3(
            (x * dimensions.width) / 2,
            (y * dimensions.height) / 2,
            (z * dimensions.depth) / 2
          ).applyQuaternion(rotation)
        )
  const projected = new THREE.Vector3()
  for (let step = 0; step < 80; step++) {
    const aboveFrame = corners.every(
      (corner) => projected.copy(corner).add(origin).project(camera).y > 1.08
    )
    if (aboveFrame) return origin
    origin.y += 0.25
  }
  return origin
}
