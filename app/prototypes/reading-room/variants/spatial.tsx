'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Raycaster,
  Scene,
  SpotLight,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Object3D
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'

import type { LibraryBook } from '@/lib/library-schema'

import './spatial.css'

type Position = [number, number, number]

interface BookSlot {
  position: Position
  width: number
  depth: number
  rotationY: number
}

interface SalonManifest {
  camera: { position: Position; target: Position; fov: number }
  slots: BookSlot[]
}

interface TableBook {
  book: LibraryBook
  group: Group
  cover: Mesh<PlaneGeometry, MeshStandardMaterial>
  restY: number
  lift: { from: number; to: number; started: number }
}

interface SpatialRuntime {
  setBooks: (books: LibraryBook[]) => void
  setSelectedId: (id: string | undefined) => void
  highlight: (index: number, immediate?: boolean) => void
  clearHighlight: () => void
}

const DEFAULT_MANIFEST: SalonManifest = {
  camera: { position: [0, 3.55, 6.8], target: [0, 1.9, -0.6], fov: 43.5 },
  slots: Array.from({ length: 12 }, (_, index) => ({
    position: [
      [-1.65, -0.55, 0.55, 1.65][index % 4]!,
      1.09,
      [0.4, 1.3, 2.2][Math.floor(index / 4)]!
    ],
    width: 0.64,
    depth: 0.81,
    rotationY: [-0.045, 0.025, -0.022, 0.05][index % 4]!
  }))
}

const BOOK_COLORS = [
  '#394249',
  '#6b3930',
  '#364e48',
  '#7f6950',
  '#2d3a49',
  '#594636'
]
const REFERENCE_IMAGE = '/rooms/reference/royal-salon-intimate.jpg'
const MATERIAL_STUDIES = new Set(['77566', '43419431'])

function disposeObject(object: Object3D) {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()

  object.traverse((child) => {
    if (child instanceof Mesh) {
      geometries.add(child.geometry)
      const meshMaterials = Array.isArray(child.material)
        ? child.material
        : [child.material]
      for (const material of meshMaterials) materials.add(material)
    } else if (child instanceof Sprite) {
      materials.add(child.material)
    }
  })

  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) textures.add(value)
    }
    material.dispose()
  }

  for (const geometry of geometries) geometry.dispose()
  for (const texture of textures) texture.dispose()
}

function makeCoverFallback(book: LibraryBook, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 384
  canvas.height = 512
  const context = canvas.getContext('2d')!
  context.fillStyle = color
  context.fillRect(0, 0, 384, 512)
  context.strokeStyle = '#c1a975'
  context.lineWidth = 2
  context.strokeRect(20, 20, 344, 472)
  context.fillStyle = '#e8dec7'
  context.textAlign = 'center'
  context.font = '30px Georgia'
  const words = book.title.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const nextLine = line ? `${line} ${word}` : word
    if (context.measureText(nextLine).width > 300 && line) {
      lines.push(line)
      line = word
    } else {
      line = nextLine
    }
  }
  if (line) lines.push(line)
  lines
    .slice(0, 8)
    .forEach((text, index) => context.fillText(text, 192, 155 + index * 38))
  context.font = '16px Georgia'
  context.fillText(book.authors[0] ?? '', 192, 440, 300)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

function makePageTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 128
  const context = canvas.getContext('2d')!
  context.fillStyle = '#d6c6a1'
  context.fillRect(0, 0, 16, 128)
  for (let y = 1; y < 128; y += 3) {
    context.fillStyle = y % 2 ? '#c3b391' : '#e7ddc0'
    context.fillRect(0, y, 16, 1)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

function makeFlameTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 256
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(64, 186, 3, 64, 150, 106)
  gradient.addColorStop(0, 'rgba(255,244,195,1)')
  gradient.addColorStop(0.19, 'rgba(255,182,62,.95)')
  gradient.addColorStop(0.48, 'rgba(244,84,15,.56)')
  gradient.addColorStop(1, 'rgba(202,44,7,0)')
  context.fillStyle = gradient
  context.beginPath()
  context.moveTo(64, 5)
  context.bezierCurveTo(110, 93, 116, 157, 93, 220)
  context.bezierCurveTo(73, 251, 25, 234, 29, 190)
  context.bezierCurveTo(25, 127, 73, 92, 64, 5)
  context.fill()
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

// The same strong ease-out used by the interface: cubic-bezier(.23, 1, .32, 1).
function easeOut(progress: number) {
  let time = progress
  for (let iteration = 0; iteration < 4; iteration++) {
    const inverse = 1 - time
    const x =
      3 * inverse * inverse * time * 0.23 +
      3 * inverse * time * time * 0.32 +
      time ** 3
    const derivative =
      0.69 * inverse * inverse + 0.54 * inverse * time + 2.04 * time * time
    if (derivative > 0.001)
      time = MathUtils.clamp(time - (x - progress) / derivative, 0, 1)
  }
  return 1 - (1 - time) ** 3
}

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((part) => Number.isFinite(part))
  )
}

function readManifest(value: unknown): SalonManifest {
  if (!value || typeof value !== 'object') return DEFAULT_MANIFEST
  const manifest = value as Partial<SalonManifest>
  const camera = manifest.camera
  const slots = manifest.slots
  return {
    camera:
      camera &&
      isPosition(camera.position) &&
      isPosition(camera.target) &&
      Number.isFinite(camera.fov)
        ? camera
        : DEFAULT_MANIFEST.camera,
    slots:
      Array.isArray(slots) &&
      slots.length >= 12 &&
      slots.every(
        (slot) =>
          isPosition(slot.position) &&
          Number.isFinite(slot.width) &&
          Number.isFinite(slot.depth) &&
          Number.isFinite(slot.rotationY)
      )
        ? slots
        : DEFAULT_MANIFEST.slots
  }
}

export default function Spatial({
  books,
  onSelect,
  selectedId
}: {
  books: LibraryBook[]
  onSelect: (book: LibraryBook, origin?: DOMRect) => void
  selectedId?: string
  rain?: boolean
  fire?: boolean
}) {
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<SpatialRuntime | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>(
    'loading'
  )
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const tableBooks = books.slice(0, 12)
  const selectedBook = tableBooks.find((book) => book.id === highlightedId)
  const getBooks = useEffectEvent(() => books.slice(0, 12))
  const getSelectedId = useEffectEvent(() => selectedId)
  const reportRendererFailure = useEffectEvent(() => setStatus('fallback'))
  const selectBook = useEffectEvent((book: LibraryBook, origin: DOMRect) =>
    onSelect(book, origin)
  )

  useEffect(() => {
    const host = canvasHostRef.current
    if (!host) return

    let disposed = false
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
      })
    } catch {
      queueMicrotask(() => {
        if (!disposed) reportRendererFailure()
      })
      return () => {
        disposed = true
      }
    }

    let frame = 0
    let sceneReady = false
    let contextLost = false
    let highlightedIndex = -1
    let keyboardHighlight = false
    let manifest = DEFAULT_MANIFEST
    let bookGeneration = 0
    let activeBooks: TableBook[] = []
    let openBookId = getSelectedId()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const hoverPointer = window.matchMedia('(hover: hover) and (pointer: fine)')
    const scene = new Scene()
    scene.background = new Color('#191d21')
    scene.fog = new FogExp2('#34302b', 0.024)
    const camera = new PerspectiveCamera(manifest.camera.fov, 1, 0.1, 70)
    const cameraTarget = new Vector3(...manifest.camera.target)
    const cameraHome = new Vector3(...manifest.camera.position)
    const raycaster = new Raycaster()
    const pointer = new Vector2(2, 2)
    const pointerDrift = new Vector2()
    const booksGroup = new Group()
    scene.add(booksGroup)

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.02
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFShadowMap
    renderer.shadowMap.autoUpdate = false
    renderer.domElement.className = 'spatial-room__canvas'
    renderer.domElement.setAttribute('aria-hidden', 'true')
    host.append(renderer.domElement)

    const ambient = new HemisphereLight('#a6bdd1', '#241810', 0.16)
    scene.add(ambient)

    const moonlight = new DirectionalLight('#8faed0', 0.72)
    moonlight.position.set(-4.05, 4.5, 0.6)
    moonlight.target.position.set(0.8, 0.2, 1.2)
    moonlight.castShadow = true
    moonlight.shadow.mapSize.set(2048, 2048)
    moonlight.shadow.camera.left = -7
    moonlight.shadow.camera.right = 7
    moonlight.shadow.camera.top = 7
    moonlight.shadow.camera.bottom = -7
    moonlight.shadow.camera.near = 0.5
    moonlight.shadow.camera.far = 22
    moonlight.shadow.normalBias = 0.006
    moonlight.shadow.bias = -0.0003
    moonlight.shadow.radius = 3
    scene.add(moonlight, moonlight.target)

    const chandelierLight = new PointLight('#ffd49a', 16, 9, 2)
    chandelierLight.position.set(0, 4.35, -1.2)
    scene.add(chandelierLight)

    // A broad pool from above the reading table keeps the books legible without
    // filling the shelving and carved stone with the same light.
    const tableLight = new SpotLight('#ffe3b7', 60, 6, 0.72, 0.8, 2)
    tableLight.position.set(0, 4.1, 2.8)
    tableLight.target.position.set(0, 1.075, 1.3)
    tableLight.castShadow = true
    tableLight.shadow.mapSize.set(1024, 1024)
    tableLight.shadow.camera.near = 0.3
    tableLight.shadow.camera.far = 15
    tableLight.shadow.normalBias = 0.004
    tableLight.shadow.bias = -0.0003
    tableLight.shadow.radius = 4
    scene.add(tableLight, tableLight.target)

    const readingLamp = new PointLight('#ffc17e', 9, 5, 2)
    readingLamp.position.set(0.26, 1.67, -0.03)
    scene.add(readingLamp)

    const armchairLamp = new PointLight('#ffc17e', 8, 5, 2)
    armchairLamp.position.set(-2.55, 1.55, -2.24)
    scene.add(armchairLamp)

    const fireLight = new PointLight('#ff8c3d', 14, 6, 2)
    fireLight.position.set(2.65, 0.68, -2.68)
    scene.add(fireLight)

    const fireTexture = makeFlameTexture()
    const flames = Array.from({ length: 5 }, (_, index) => {
      const material = new SpriteMaterial({
        map: fireTexture,
        color: index % 2 ? '#ffb75b' : '#ffce81',
        transparent: true,
        opacity: 0.72,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      })
      const flame = new Sprite(material)
      flame.position.set(
        2.65 + (index - 2) * 0.115,
        0.58 + (index % 2) * 0.08,
        -2.88
      )
      flame.scale.set(0.31, 0.66 + (index % 3) * 0.075, 1)
      scene.add(flame)
      return flame
    })

    const pmrem = new PMREMGenerator(renderer)
    const environment = new RoomEnvironment()
    const environmentTarget = pmrem.fromScene(environment, 0.035)
    scene.environment = environmentTarget.texture
    scene.environmentIntensity = 0.085
    environment.dispose()
    pmrem.dispose()

    const composer = new EffectComposer(renderer)
    const samples = Math.min(4, renderer.capabilities.maxSamples)
    composer.renderTarget1.samples = samples
    composer.renderTarget2.samples = samples
    const roomPass = new RenderPass(scene, camera)
    const depthOfField = new BokehPass(scene, camera, {
      focus: 5.9,
      aperture: 0.00065,
      maxblur: 0.002
    })
    const focusUniform = (depthOfField.uniforms as { focus: { value: number } })
      .focus
    const outputPass = new OutputPass()
    composer.addPass(roomPass)
    composer.addPass(depthOfField)
    composer.addPass(outputPass)
    const focusPoint = new Vector3(0, 1.15, 1.3)
    const focusDirection = new Vector3()

    function resize() {
      const width = host!.clientWidth
      const height = host!.clientHeight
      if (!width || !height) return
      const aspect = width / height
      camera.aspect = aspect
      const narrowness = Math.max(0, 1.45 - aspect)
      camera.fov = manifest.camera.fov + Math.min(narrowness * 10, 12)
      cameraTarget.fromArray(manifest.camera.target)
      cameraHome
        .fromArray(manifest.camera.position)
        .sub(cameraTarget)
        .multiplyScalar(1 + narrowness * 0.35)
        .add(cameraTarget)
      camera.position.copy(cameraHome)
      camera.lookAt(cameraTarget)
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
      composer.setSize(width, height)
      depthOfField.enabled = width >= 900
      camera.getWorldDirection(focusDirection)
      focusUniform.value = focusPoint
        .clone()
        .sub(cameraHome)
        .dot(focusDirection)
    }

    function highlight(index: number, immediate = false) {
      if (index === highlightedIndex && immediate === keyboardHighlight) return
      keyboardHighlight = immediate
      highlightedIndex = index
      const now = performance.now()
      for (let bookIndex = 0; bookIndex < activeBooks.length; bookIndex++) {
        const entry = activeBooks[bookIndex]!
        const active = bookIndex === index
        const y = entry.restY + (active && !reducedMotion.matches ? 0.12 : 0)
        entry.lift = { from: entry.group.position.y, to: y, started: now }
        if (immediate || reducedMotion.matches) {
          entry.group.position.y = y
          renderer.shadowMap.needsUpdate = true
        }
        entry.cover.material.emissive.set(active ? '#cfbd8d' : '#000000')
        entry.cover.material.emissiveIntensity = active ? 0.14 : 0
      }
      host!.style.cursor = index >= 0 && !immediate ? 'pointer' : ''
      setHighlightedId(activeBooks[index]?.book.id ?? null)
    }

    function setSelectedId(id: string | undefined) {
      if (openBookId === id) return
      openBookId = id
      for (const entry of activeBooks)
        entry.group.visible = entry.book.id !== id
      renderer.shadowMap.needsUpdate = true
    }

    function setBooks(nextBooks: LibraryBook[]) {
      const generation = ++bookGeneration
      highlightedIndex = -1
      for (const entry of activeBooks) {
        booksGroup.remove(entry.group)
        disposeObject(entry.group)
      }
      activeBooks = []
      const textureLoader = new TextureLoader()

      nextBooks.slice(0, 12).forEach((book, index) => {
        const slot = manifest.slots[index] ?? DEFAULT_MANIFEST.slots[index]!
        const color = BOOK_COLORS[index % BOOK_COLORS.length]!
        const thickness = 0.055 + Math.min(book.pageCount ?? 250, 700) * 0.00004
        const group = new Group()
        group.visible = book.id !== openBookId
        group.position.fromArray(slot.position)
        group.position.y -= 0.0145
        group.rotation.y = slot.rotationY
        group.userData.bookIndex = index

        const boardsMaterial = new MeshStandardMaterial({
          color,
          roughness: 0.75,
          metalness: 0.04
        })
        const bottomBoard = new Mesh(
          new RoundedBoxGeometry(slot.width, 0.009, slot.depth, 2, 0.004),
          boardsMaterial
        )
        bottomBoard.position.y = 0.006
        const topBoard = new Mesh(
          new RoundedBoxGeometry(slot.width, 0.009, slot.depth, 2, 0.004),
          boardsMaterial
        )
        topBoard.position.y = thickness
        const pages = new Mesh(
          new BoxGeometry(
            slot.width - 0.018,
            thickness - 0.01,
            slot.depth - 0.022
          ),
          new MeshStandardMaterial({ map: makePageTexture(), roughness: 0.93 })
        )
        pages.position.set(0.004, thickness / 2, 0)
        const spine = new Mesh(
          new BoxGeometry(0.018, thickness, slot.depth),
          boardsMaterial
        )
        spine.position.set(-slot.width / 2 + 0.009, thickness / 2, 0)
        const fallbackTexture = makeCoverFallback(book, color)
        const coverMaterial = new MeshStandardMaterial({
          map: fallbackTexture,
          color: '#ffffff',
          roughness: 0.83,
          metalness: 0,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1
        })
        const cover = new Mesh(
          new PlaneGeometry(slot.width, slot.depth),
          coverMaterial
        )
        cover.rotation.x = -Math.PI / 2
        cover.position.y = thickness + 0.005
        group.add(bottomBoard, topBoard, pages, spine, cover)
        group.traverse((object) => {
          if (object instanceof Mesh) {
            object.castShadow = true
            object.receiveShadow = true
            object.userData.bookIndex = index
          }
        })
        booksGroup.add(group)
        activeBooks.push({
          book,
          group,
          cover,
          restY: group.position.y,
          lift: { from: group.position.y, to: group.position.y, started: 0 }
        })

        const coverUrl = MATERIAL_STUDIES.has(book.id)
          ? `/covers/textures/${book.id}.jpg`
          : (book.cover.localPath ?? book.cover.remoteUrl)
        if (coverUrl) {
          textureLoader.load(
            coverUrl,
            (texture) => {
              if (disposed || generation !== bookGeneration) {
                texture.dispose()
                return
              }
              texture.colorSpace = SRGBColorSpace
              texture.anisotropy = Math.min(
                8,
                renderer.capabilities.getMaxAnisotropy()
              )
              const image = texture.image as { width: number; height: number }
              const aspectRatio = image.width / image.height
              const bookWidth = Math.min(slot.width, slot.depth * aspectRatio)
              group.scale.set(
                bookWidth / slot.width,
                1,
                bookWidth / aspectRatio / slot.depth
              )
              coverMaterial.map = texture
              coverMaterial.needsUpdate = true
              fallbackTexture.dispose()
              renderer.shadowMap.needsUpdate = true
            },
            undefined,
            () => {
              // The typeset cover already on the mesh remains readable if a cover is unavailable.
            }
          )
        }
      })
      renderer.shadowMap.needsUpdate = true
    }

    function pick(event: PointerEvent | MouseEvent) {
      if (openBookId) return -1
      const bounds = renderer.domElement.getBoundingClientRect()
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1
      )
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(booksGroup.children, true)[0]
      return hit ? (hit.object.userData.bookIndex as number) : -1
    }

    function onPointerMove(event: PointerEvent) {
      if (!hoverPointer.matches || event.pointerType === 'touch') return
      const index = pick(event)
      pointerDrift.copy(pointer)
      highlight(index)
    }

    function clearHighlight() {
      pointerDrift.set(0, 0)
      highlight(-1)
    }

    function onClick(event: MouseEvent) {
      const entry = activeBooks[pick(event)]
      if (!entry || !sceneReady) return
      const bounds = renderer.domElement.getBoundingClientRect()
      const box = new Box3().setFromObject(entry.group)
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            const point = new Vector3(x, y, z).project(camera)
            const screenX = bounds.left + ((point.x + 1) / 2) * bounds.width
            const screenY = bounds.top + ((1 - point.y) / 2) * bounds.height
            left = Math.min(left, screenX)
            right = Math.max(right, screenX)
            top = Math.min(top, screenY)
            bottom = Math.max(bottom, screenY)
          }
        }
      }
      selectBook(entry.book, new DOMRect(left, top, right - left, bottom - top))
    }

    function onContextLost(event: Event) {
      event.preventDefault()
      contextLost = true
      cancelAnimationFrame(frame)
      if (!disposed) setStatus('fallback')
    }

    function render(now: number) {
      if (disposed || contextLost || document.hidden) return
      const time = now / 1000
      for (const entry of activeBooks) {
        if (keyboardHighlight || reducedMotion.matches) continue
        const progress = Math.min(1, (now - entry.lift.started) / 160)
        entry.group.position.y = MathUtils.lerp(
          entry.lift.from,
          entry.lift.to,
          easeOut(progress)
        )
        if (progress < 1) renderer.shadowMap.needsUpdate = true
      }
      // A stationary room: tiny pointer-driven camera offsets only, no autonomous drift.
      const driftX =
        !reducedMotion.matches && hoverPointer.matches
          ? pointerDrift.x * 0.025
          : 0
      const driftY =
        !reducedMotion.matches && hoverPointer.matches
          ? pointerDrift.y * 0.014
          : 0
      camera.position.set(
        cameraHome.x + driftX,
        cameraHome.y + driftY,
        cameraHome.z
      )
      camera.lookAt(cameraTarget)
      if (!reducedMotion.matches) {
        fireLight.intensity =
          14 + Math.sin(time * 3.2) * 1.1 + Math.sin(time * 7.1) * 0.4
        flames.forEach((flame, index) => {
          flame.material.opacity =
            0.66 + Math.sin(time * 2.3 + index * 1.7) * 0.09
          flame.scale.y =
            0.66 + (index % 3) * 0.075 + Math.sin(time * 2.1 + index) * 0.028
        })
      }
      composer.render()
      frame = requestAnimationFrame(render)
    }

    function onVisibilityChange() {
      cancelAnimationFrame(frame)
      if (!document.hidden && sceneReady) frame = requestAnimationFrame(render)
    }

    function onReducedMotionChange() {
      pointerDrift.set(0, 0)
      fireLight.intensity = 14
      for (const entry of activeBooks) {
        entry.group.position.y = entry.restY
        entry.lift = { from: entry.restY, to: entry.restY, started: 0 }
      }
      renderer.shadowMap.needsUpdate = true
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)
    renderer.domElement.addEventListener('pointermove', onPointerMove, {
      passive: true
    })
    renderer.domElement.addEventListener('pointerleave', clearHighlight)
    renderer.domElement.addEventListener('click', onClick)
    renderer.domElement.addEventListener('webglcontextlost', onContextLost)
    document.addEventListener('visibilitychange', onVisibilityChange)
    reducedMotion.addEventListener('change', onReducedMotionChange)
    runtimeRef.current = { setBooks, setSelectedId, highlight, clearHighlight }
    resize()

    const manifestRequest = fetch('/rooms/spatial/manifest.json')
      .then((response) => (response.ok ? response.json() : null))
      .then(readManifest)
      .catch(() => DEFAULT_MANIFEST)
    const modelRequest = fetch('/rooms/spatial/royal-salon.glb')
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .catch(() => null)

    void Promise.all([manifestRequest, modelRequest])
      .then(async ([nextManifest, buffer]) => {
        if (disposed) return
        if (!buffer) {
          setStatus('fallback')
          return
        }
        manifest = nextManifest
        const gltf = await new GLTFLoader().parseAsync(
          buffer,
          '/rooms/spatial/'
        )
        if (disposed || contextLost) {
          disposeObject(gltf.scene)
          return
        }
        const adjustedMaterials = new Set<Material>()
        gltf.scene.traverse((object) => {
          if (object instanceof Mesh) {
            const materials = Array.isArray(object.material)
              ? object.material
              : [object.material]
            object.castShadow = !materials.some((material) =>
              /Rain|Flame|Ember|midnight|gilding|brass/i.test(material.name)
            )
            object.receiveShadow = true
            for (const material of materials) {
              if (
                !(material instanceof MeshStandardMaterial) ||
                adjustedMaterials.has(material)
              )
                continue
              adjustedMaterials.add(material)
              if (material.name === 'Warm carved marble')
                material.color.multiplyScalar(0.55)
              if (material.name.startsWith('Leather binding'))
                material.color.multiplyScalar(0.58)
              if (material.name === 'Rain blue window light')
                material.color.multiplyScalar(0.42)
            }
          }
        })
        scene.add(gltf.scene)
        setBooks(getBooks())
        resize()
        sceneReady = true
        composer.render()
        setStatus('ready')
        frame = requestAnimationFrame(render)
      })
      .catch(() => {
        if (!disposed) setStatus('fallback')
      })

    return () => {
      disposed = true
      bookGeneration++
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerleave', clearHighlight)
      renderer.domElement.removeEventListener('click', onClick)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      reducedMotion.removeEventListener('change', onReducedMotionChange)
      runtimeRef.current = null
      disposeObject(scene)
      roomPass.dispose()
      depthOfField.dispose()
      outputPass.dispose()
      composer.dispose()
      environmentTarget.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [])

  useEffect(() => {
    runtimeRef.current?.setBooks(books.slice(0, 12))
  }, [books])

  useEffect(() => {
    runtimeRef.current?.setSelectedId(selectedId)
  }, [selectedId])

  return (
    <section
      className={`spatial-room spatial-room--${status}`}
      aria-label='A three-dimensional mansion library'
    >
      <div
        className='spatial-room__reference'
        style={{ backgroundImage: `url(${REFERENCE_IMAGE})` }}
      />
      <div className='spatial-room__viewport' ref={canvasHostRef} />
      <div className='spatial-room__vignette' />

      {status !== 'ready' ? (
        <div className='spatial-room__loading' role='status'>
          <span className='spatial-room__loading-mark' aria-hidden='true'>
            ✦
          </span>
          <span>
            {status === 'loading'
              ? 'Opening the salon'
              : 'The salon, in stillness'}
          </span>
          <small>
            {status === 'loading'
              ? 'Lighting the room and setting out your books'
              : 'Browse the books below to begin reading'}
          </small>
        </div>
      ) : null}

      <div className='spatial-room__book-rail'>
        <div className='spatial-room__rail-caption'>
          <span>ON THE TABLE</span>
          <p aria-live='polite'>
            {selectedBook ? selectedBook.title : 'Choose a book. Stay a while.'}
          </p>
          <span>{String(tableBooks.length).padStart(2, '0')} VOLUMES</span>
        </div>
        <div
          className='spatial-room__book-buttons'
          role='group'
          aria-label='Books on the reading table'
        >
          {tableBooks.map((book, index) => (
            <button
              key={book.id}
              type='button'
              className={`spatial-room__book-button${highlightedId === book.id ? ' is-highlighted' : ''}`}
              onFocus={() => runtimeRef.current?.highlight(index, true)}
              onBlur={() => runtimeRef.current?.clearHighlight()}
              onMouseEnter={() => runtimeRef.current?.highlight(index)}
              onMouseLeave={() => runtimeRef.current?.clearHighlight()}
              onClick={(event) =>
                onSelect(book, event.currentTarget.getBoundingClientRect())
              }
              title={`${book.title} — ${book.authors.join(', ')}`}
              aria-label={`Open ${book.title} by ${book.authors.join(', ')}`}
            >
              <span className='spatial-room__book-number'>
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className='spatial-room__book-title'>{book.title}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
