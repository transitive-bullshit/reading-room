import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

import type { BookDimensions } from './physics-world'

const layers = [
  { spread: 0.006, opacity: 0.18, color: '#d4cbbb' },
  { spread: 0.014, opacity: 0.065, color: '#c5b9a5' },
  { spread: 0.029, opacity: 0.025, color: '#b8aa94' },
  { spread: 0.046, opacity: 0.008, color: '#aa9d87' }
]

/** One halo follows the active book; opaque books hide its interior and back edges. */
export function createBookSelection() {
  const mesh = new THREE.Group()
  mesh.visible = false
  mesh.matrixAutoUpdate = false
  mesh.renderOrder = 5
  const parentInverse = new THREE.Matrix4()
  const size = new THREE.Vector3()
  const shells = layers.map((layer) => {
    const shell = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: layer.color,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        toneMapped: false
      })
    )
    shell.raycast = () => {}
    shell.castShadow = false
    shell.receiveShadow = false
    mesh.add(shell)
    return shell
  })

  function update(
    bookMesh: THREE.Group,
    dimensions: BookDimensions,
    opacity: number
  ) {
    const strength = THREE.MathUtils.clamp(opacity, 0, 1)
    mesh.visible = bookMesh.visible && strength > 0.001
    if (!mesh.visible) return
    const { width, height, depth } = dimensions
    if (size.x !== width || size.y !== height || size.z !== depth) {
      size.set(width, height, depth)
      shells.forEach((shell, index) => {
        const spread = layers[index]!.spread
        shell.geometry.dispose()
        shell.geometry = new RoundedBoxGeometry(
          width + spread * 2,
          height + spread * 2,
          depth + spread * 2,
          2,
          0.008 + spread
        )
      })
    }
    bookMesh.updateWorldMatrix(true, false)
    if (mesh.parent) {
      mesh.parent.updateWorldMatrix(true, false)
      parentInverse.copy(mesh.parent.matrixWorld).invert()
      mesh.matrix.multiplyMatrices(parentInverse, bookMesh.matrixWorld)
    } else mesh.matrix.copy(bookMesh.matrixWorld)
    mesh.matrixWorldNeedsUpdate = true
    shells.forEach((shell, index) => {
      shell.material.opacity = layers[index]!.opacity * strength
    })
  }

  function dispose() {
    mesh.removeFromParent()
    shells.forEach((shell) => {
      shell.geometry.dispose()
      shell.material.dispose()
    })
    mesh.clear()
  }

  return { mesh, update, dispose }
}
