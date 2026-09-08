import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

import type { LibraryBook } from '@/lib/library-schema'
import coverAspects from '@/data/cover-aspects.json'

import { bookDimensions } from './physics-world'

function paperTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const context = canvas.getContext('2d')!
  context.fillStyle = '#d8c9a7'
  context.fillRect(0, 0, 512, 128)
  for (let y = 0; y < 128; y++) {
    const shade =
      184 + Math.round(19 * Math.sin(y * 3.79) + 10 * Math.sin(y * 0.49))
    context.fillStyle = `rgba(${shade}, ${shade - 12}, ${shade - 29}, ${y % 8 === 0 ? 0.72 : 0.35})`
    context.fillRect(0, y, 512, 1)
  }
  for (let x = 0; x < 512; x += 3) {
    context.fillStyle = `rgba(83,64,38,${0.01 + (Math.sin(x * 1.7) + 1) * 0.012})`
    context.fillRect(x, 0, 1, 128)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function clothTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')!
  const image = context.createImageData(128, 128)
  for (let index = 0; index < image.data.length; index += 4) {
    const pixel = index / 4
    const value = 118 + (Math.sin(pixel * 7.23) + Math.cos(pixel * 0.039)) * 21
    image.data[index] = image.data[index + 1] = image.data[index + 2] = value
    image.data[index + 3] = 255
  }
  context.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(5, 7)
  return texture
}

function coverTone(texture: THREE.Texture) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 16
  const context = canvas.getContext('2d')!
  try {
    context.drawImage(texture.image as HTMLImageElement, 0, 0, 16, 16)
    const pixels = context.getImageData(0, 0, 3, 16).data
    const rgb = [0, 0, 0]
    for (let index = 0; index < pixels.length; index += 4) {
      rgb[0]! += pixels[index]!
      rgb[1]! += pixels[index + 1]!
      rgb[2]! += pixels[index + 2]!
    }
    return new THREE.Color(
      `rgb(${rgb.map((value) => Math.round(value / 48)).join(',')})`
    )
  } catch {
    return new THREE.Color('#493e35')
  }
}

interface BookMeshOptions {
  maxTextureEdge?: number
  compact?: boolean
}

export async function makeBookMesh(
  book: LibraryBook,
  anisotropy: number,
  options: BookMeshOptions = {}
) {
  const loader = new THREE.TextureLoader()
  let cover: THREE.Texture
  try {
    cover = await loader.loadAsync(`/covers/textures/${book.id}.jpg`)
  } catch {
    cover = await loader.loadAsync(
      book.cover.localPath ?? book.cover.remoteUrl ?? ''
    )
  }
  cover.colorSpace = THREE.SRGBColorSpace
  cover.anisotropy = anisotropy
  const coverImage = cover.image as HTMLImageElement
  const aspect =
    (coverAspects as Record<string, number>)[book.id] ??
    coverImage.width / coverImage.height
  if (
    options.maxTextureEdge &&
    Math.max(coverImage.width, coverImage.height) > options.maxTextureEdge
  ) {
    const scale =
      options.maxTextureEdge / Math.max(coverImage.width, coverImage.height)
    const resized = document.createElement('canvas')
    resized.width = Math.max(1, Math.round(coverImage.width * scale))
    resized.height = Math.max(1, Math.round(coverImage.height * scale))
    const context = resized.getContext('2d')!
    context.imageSmoothingQuality = 'high'
    context.drawImage(coverImage, 0, 0, resized.width, resized.height)
    cover.image = resized
    cover.needsUpdate = true
    cover.anisotropy = Math.min(8, anisotropy)
  }
  const dimensions = bookDimensions(aspect, book.pageCount ?? 350)
  const { width, depth, height } = dimensions
  const group = new THREE.Group()
  group.userData.bookId = book.id
  const paper = paperTexture()
  const cloth = clothTexture()
  const tone = coverTone(cover)
  const board = new THREE.MeshStandardMaterial({
    color: tone,
    roughness: 0.83,
    bumpMap: cloth,
    bumpScale: 0.009
  })
  const paperMaterial = new THREE.MeshStandardMaterial({
    color: '#f5e9cd',
    map: paper,
    bumpMap: paper,
    bumpScale: 0.005,
    roughness: 0.97
  })
  const coverMaterial = new THREE.MeshStandardMaterial({
    map: cover,
    roughness: 0.73,
    metalness: 0.01,
    bumpMap: cloth,
    bumpScale: 0.003
  })
  const boardHeight = 0.024
  const boardGeometry = new RoundedBoxGeometry(
    width,
    boardHeight,
    depth,
    2,
    0.008
  )
  for (const sign of [-1, 1]) {
    const mesh = new THREE.Mesh(boardGeometry, board)
    mesh.position.y = sign * (height / 2 - boardHeight / 2)
    group.add(mesh)
  }
  const pages = new THREE.Mesh(
    new THREE.BoxGeometry(
      width - 0.044,
      height - boardHeight * 2,
      depth - 0.038
    ),
    paperMaterial
  )
  pages.position.x = 0.01
  group.add(pages)
  const front = new THREE.PlaneGeometry(width - 0.011, depth - 0.011)
  front.rotateX(-Math.PI / 2).translate(0, height / 2 + 0.001, 0)
  const back = new THREE.PlaneGeometry(width - 0.011, depth - 0.011)
  const backUvs = back.getAttribute('uv')
  for (let index = 0; index < backUvs.count; index++) {
    // A half-turn followed by horizontal mirroring is a vertical UV flip.
    backUvs.setY(index, 1 - backUvs.getY(index))
  }
  back.rotateX(Math.PI / 2).translate(0, -height / 2 - 0.001, 0)
  group.add(new THREE.Mesh(mergeGeometries([front, back])!, coverMaterial))
  front.dispose()
  back.dispose()
  const spine = new THREE.Mesh(
    new RoundedBoxGeometry(0.036, height - 0.014, depth - 0.006, 2, 0.009),
    board
  )
  spine.position.x = -width / 2 + 0.018
  group.add(spine)
  const hinge = new THREE.Mesh(
    new THREE.BoxGeometry(0.006, 0.002, depth - 0.045),
    new THREE.MeshStandardMaterial({
      color: tone.clone().multiplyScalar(0.47),
      roughness: 1
    })
  )
  hinge.position.set(-width / 2 + 0.055, height / 2 + 0.003, 0)
  if (options.compact) {
    hinge.geometry.dispose()
    hinge.material.dispose()
    const boards = group.children.filter(
      (
        object
      ): object is THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshStandardMaterial
      > => object instanceof THREE.Mesh && object.material === board
    )
    const sourceGeometries = new Set(boards.map((mesh) => mesh.geometry))
    const geometries = boards.map((mesh) => {
      mesh.updateMatrix()
      group.remove(mesh)
      return mesh.geometry.clone().applyMatrix4(mesh.matrix)
    })
    group.add(new THREE.Mesh(mergeGeometries(geometries)!, board))
    geometries.forEach((geometry) => geometry.dispose())
    sourceGeometries.forEach((geometry) => geometry.dispose())
  } else group.add(hinge)
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true
      object.receiveShadow = true
      object.userData.bookId = book.id
    }
  })
  return { mesh: group, dimensions }
}

export function disposeBookMesh(mesh: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  mesh.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    geometries.add(object.geometry)
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      materials.add(material)
      if (material instanceof THREE.MeshStandardMaterial) {
        if (material.map) textures.add(material.map)
        if (material.bumpMap) textures.add(material.bumpMap)
      }
    }
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  textures.forEach((texture) => texture.dispose())
}
