'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import type { LibraryBook } from '@/lib/library-schema'

import { RoomBackdrop } from './room-backdrop'
import type { SceneProps } from './scene-props'
import { disposeBookMesh, makeBookMesh } from './physics-book'
import { applyHeldBookTorque } from './physics-held'
import { createBookImpacts } from './physics-impacts'
import {
  applyBookDrag,
  createDragTarget,
  updateDragTarget,
  type DragTarget
} from './physics-drag'
import {
  alignCamera,
  makeCamera,
  offscreenDropPosition
} from './physics-camera'
import { getPileDrop, scatterAbove } from './physics-pile'
import { createMoundMemory } from './physics-mound'
import { createBookSelection } from './physics-selection'
import { makeFocusArrangement, resizeBookCollider } from './physics-focus'
import { buildPileGroups, type PileGrouping } from './pile-groups'
import {
  applyBookRearrangement,
  cancelBookRearrangement,
  createBookRearrangement,
  makePileArrangement,
  type BookRearrangement,
  type PileLabel,
  type PileTarget
} from './physics-rearrange'
import {
  applyPileBounds,
  loadPhysics,
  makeBookBody,
  makeWorld,
  PHYSICS_STEP,
  type BookBody,
  type BookDimensions
} from './physics-world'

import './table-scene.css'

type Phase =
  | 'prepared'
  | 'resting'
  | 'pickup'
  | 'selected'
  | 'returning'
  | 'leaving'
  | 'dropping'
  | 'scattering'
  | 'parking'
  | 'parked'
interface PhysicalBook {
  book: LibraryBook
  mesh: THREE.Group
  dimensions: BookDimensions
  body: BookBody
  phase: Phase
  from: THREE.Vector3
  fromRotation: THREE.Quaternion
  home: THREE.Vector3
  homeRotation: THREE.Quaternion
  start: number
  duration: number
  order: number
  scale: number
  homeScale: number
  fromScale: number
  included: boolean
  parkingTarget?: THREE.Vector3
  scaling?: { from: number; to: number; start: number; duration: number }
  guide?: BookRearrangement
  keepGroupedHome?: boolean
}
interface Runtime {
  setBooks: (books: LibraryBook[]) => Promise<void>
  start: () => void
  select: (id?: string) => void
  pickUp: (id: string) => void
  focus: (id?: string) => void
  setFire: (enabled: boolean) => void
  arrange: (grouping: PileGrouping, activeGroupId?: string) => void
  destroy: () => void
}
const ease = (value: number) => 1 - (1 - value) ** 3
const smooth = (value: number) => value * value * (3 - 2 * value)

async function prepareBookMeshes(
  books: LibraryBook[],
  anisotropy: number,
  images: HTMLImageElement[]
) {
  const completed = new Set<THREE.Group>()
  let abandoned = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const discard = (mesh: THREE.Group) => {
    disposeBookMesh(mesh)
    mesh.clear()
  }
  try {
    return await Promise.race([
      Promise.all([
        Promise.all(
          books.map(async (book) => {
            const result = await makeBookMesh(book, anisotropy, {
              maxTextureEdge: 768,
              compact: true
            })
            if (abandoned) discard(result.mesh)
            else completed.add(result.mesh)
            return result
          })
        ),
        Promise.all(images.map((image) => image.decode()))
      ]).then(([meshes]) => meshes),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Room assets took too long to prepare')),
          30_000
        )
      })
    ])
  } catch (err) {
    abandoned = true
    completed.forEach(discard)
    completed.clear()
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

async function createRuntime(
  host: HTMLDivElement,
  frame: HTMLDivElement,
  callbacks: {
    onSelect: SceneProps['onSelect']
    onHover: (book: LibraryBook | null) => void
    onReady: () => void
    onImpact: NonNullable<SceneProps['onImpact']>
    onGroupSelect: (groupId: string) => void
  }
): Promise<Runtime> {
  const physics = await loadPhysics()
  const scene = new THREE.Scene()
  const camera = makeCamera()
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance'
  })
  const world = makeWorld(physics)
  world.forEachRigidBody((body) => body.setEnabled(false))
  const impacts = createBookImpacts(physics, world)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setSize(1600, 900, false)
  renderer.setClearColor(0, 0)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.13
  renderer.domElement.setAttribute('aria-hidden', 'true')
  frame.append(renderer.domElement)
  const labelLayer = document.createElement('div')
  labelLayer.className = 'physics-pile-labels'
  frame.append(labelLayer)
  let pileLabels: PileLabel[] = []
  scene.add(new THREE.HemisphereLight('#dac8a9', '#443321', 2.4))
  const windowLight = new THREE.DirectionalLight('#ccdeef', 2.7)
  windowLight.position.set(-7, 13, -5)
  windowLight.castShadow = true
  windowLight.shadow.mapSize.set(2048, 2048)
  windowLight.shadow.camera.left = -7
  windowLight.shadow.camera.right = 7
  windowLight.shadow.camera.top = 6
  windowLight.shadow.camera.bottom = -6
  windowLight.shadow.camera.near = 1
  windowLight.shadow.camera.far = 32
  windowLight.shadow.normalBias = 0.015
  windowLight.shadow.bias = -0.0001
  windowLight.shadow.radius = 3
  scene.add(windowLight)
  const hearth = new THREE.PointLight('#ffb363', 50, 16, 2)
  hearth.position.set(7, 4, -2)
  scene.add(hearth)
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 6.365),
    new THREE.ShadowMaterial({ opacity: 0.34, color: '#15100a' })
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.002
  shadow.receiveShadow = true
  scene.add(shadow)
  const glowCanvas = document.createElement('canvas')
  glowCanvas.width = glowCanvas.height = 128
  const glowContext = glowCanvas.getContext('2d')!
  const gradient = glowContext.createRadialGradient(64, 64, 14, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(245,200,119,0.48)')
  gradient.addColorStop(0.58, 'rgba(228,174,86,0.30)')
  gradient.addColorStop(1, 'rgba(228,174,86,0)')
  glowContext.fillStyle = gradient
  glowContext.fillRect(0, 0, 128, 128)
  const glowTexture = new THREE.CanvasTexture(glowCanvas)
  const focusPool = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: glowTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    })
  )
  focusPool.rotation.x = -Math.PI / 2
  scene.add(focusPool)
  const selectionGlow = createBookSelection()
  scene.add(selectionGlow.mesh)
  let outlinedBook: PhysicalBook | undefined
  let selectionOpacity = 0
  const entries: PhysicalBook[] = []
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3)
  const target = new THREE.Vector3()
  const temp = new THREE.Vector3()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const pickupTarget = new THREE.Vector3(0, 3.35, 1.7)
  const pickupRotation = camera.quaternion
    .clone()
    .multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        Math.PI / 2
      )
    )
  let batch = 0
  let destroyed = false
  let prepared = false
  let startRequested = false
  let started = false
  let selected: string | undefined
  let hovered: string | undefined
  let focused: string | undefined
  let requestedGrouping: PileGrouping = 'free'
  let activeGroupId: string | undefined
  let moundMemory: ReturnType<typeof createMoundMemory> | undefined
  let moundTargets: Promise<ReadonlyMap<string, PileTarget>> | undefined
  let moundPristine = true
  let arrangementRevision = 0
  const arrangementExempt = new Set<string>()
  let previousTime = performance.now()
  let accumulator = 0
  let simulationTime = 0
  let animationFrame = 0
  let press:
    | {
        entry: PhysicalBook
        x: number
        y: number
        pointerId: number
        drag: boolean
        screenOffset: THREE.Vector2
        target?: DragTarget
        orientation: THREE.Quaternion
      }
    | undefined
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches
  let mobile = host.clientWidth <= 620
  function setBookScale(entry: PhysicalBook, value: number) {
    if (Math.abs(value - entry.scale) < 0.00001) return
    entry.scale = value
    entry.mesh.scale.setScalar(value)
    resizeBookCollider(entry.body, entry.dimensions, value)
  }
  function animateBookScale(entry: PhysicalBook, value: number) {
    entry.scaling = {
      from: entry.scale,
      to: value,
      start: simulationTime,
      duration: reducedMotion ? 0.18 : 0.85
    }
  }
  function visibleDimensions(entry: PhysicalBook): BookDimensions {
    return {
      width: entry.dimensions.width * entry.scale,
      height: entry.dimensions.height * entry.scale,
      depth: entry.dimensions.depth * entry.scale,
      mass: entry.dimensions.mass
    }
  }
  function parkBook(entry: PhysicalBook, index: number) {
    if (entry.phase === 'parked' || entry.phase === 'selected') return
    if (press?.entry === entry) {
      if (host.hasPointerCapture(press.pointerId))
        host.releasePointerCapture(press.pointerId)
      press = undefined
      host.classList.remove('is-dragging')
    }
    entry.guide = undefined
    entry.scaling = undefined
    entry.body.collider(0).setEnabled(false)
    entry.body.setBodyType(physics.RigidBodyType.KinematicPositionBased, true)
    entry.body.resetForces(true)
    entry.body.resetTorques(true)
    if (reducedMotion) {
      entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      entry.body.setEnabled(false)
      entry.mesh.visible = false
      entry.phase = 'parked'
      return
    }
    entry.from.copy(entry.body.translation())
    entry.fromRotation.copy(entry.body.rotation())
    entry.parkingTarget = entry.from.clone()
    entry.parkingTarget.x = entry.from.x < 0 ? -13 : 13
    entry.parkingTarget.y += 0.16
    entry.phase = 'parking'
    entry.start = performance.now() + Math.min(index * 4, 180)
    entry.duration = 540
    entry.body.setEnabled(true)
  }
  function projectLabels() {
    if (!pileLabels.length) return
    const projected = pileLabels.map((label) => {
      temp
        .set(label.position.x, label.position.y, label.position.z)
        .project(camera)
      return { x: ((temp.x + 1) / 2) * 1600, y: ((1 - temp.y) / 2) * 900 }
    })
    const frameBounds = frame.getBoundingClientRect()
    const hostBounds = host.getBoundingClientRect()
    const scale = frameBounds.width / 1600
    const gutter = 8 / scale
    const visibleLeft = (hostBounds.left - frameBounds.left) / scale + gutter
    const visibleRight = (hostBounds.right - frameBounds.left) / scale - gutter
    const room = host.closest('.reading-room')
    const controls = room
      ?.querySelector('.room-grouping')
      ?.getBoundingClientRect()
    const heading = room
      ?.querySelector('.room-heading')
      ?.getBoundingClientRect()
    const upperEdge = mobile ? controls?.bottom : heading?.bottom
    const lowerEdge = mobile ? hostBounds.bottom : controls?.top
    const visibleTop =
      ((upperEdge ?? hostBounds.top) - frameBounds.top) / scale + gutter
    const visibleBottom =
      ((lowerEdge ?? hostBounds.bottom) - frameBounds.top) / scale - gutter
    projected.forEach((point, index) => {
      const element = labelLayer.children[index] as HTMLElement | undefined
      if (!element) return
      const row = projected.filter(
        (_, otherIndex) =>
          Math.sign(pileLabels[otherIndex]!.position.z) ===
          Math.sign(pileLabels[index]!.position.z)
      )
      const left = Math.max(
        visibleLeft,
        ...row
          .filter((other) => other.x < point.x)
          .map((other) => (other.x + point.x) / 2 + gutter / 2)
      )
      const right = Math.min(
        visibleRight,
        ...row
          .filter((other) => other.x > point.x)
          .map((other) => (other.x + point.x) / 2 - gutter / 2)
      )
      // Give each projected pile its own cell before wrapping the label, so
      // keeping an edge label on screen cannot cover its neighbor's button.
      element.style.width = `${Math.min(220, right - left)}px`
      const x = THREE.MathUtils.clamp(
        point.x,
        left + element.offsetWidth / 2,
        right - element.offsetWidth / 2
      )
      const y = THREE.MathUtils.clamp(
        point.y,
        visibleTop + element.offsetHeight / 2,
        visibleBottom - element.offsetHeight / 2
      )
      element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`
    })
  }
  const resize = () => {
    const scale = Math.max(host.clientWidth / 1600, host.clientHeight / 900)
    frame.style.setProperty('--scene-scale', String(scale))
    const nextMobile = host.clientWidth <= 620
    const organized = requestedGrouping !== 'free'
    if (nextMobile)
      alignCamera(
        camera,
        (host.clientWidth / scale - 30) / (organized ? 960 : 810),
        organized && !activeGroupId ? 0.78 : 0.9,
        565
      )
    else
      alignCamera(camera, Math.min(1, (host.clientWidth / scale - 65) / 1200))
    const resizedMound = nextMobile !== mobile && Boolean(moundMemory)
    const wasRestoring = requestedGrouping === 'free' && Boolean(moundTargets)
    mobile = nextMobile
    if (resizedMound) {
      arrangementRevision++
      resetMoundMemory(false)
      if (wasRestoring) arrange('free', activeGroupId)
    }
    projectLabels()
  }
  resize()
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  function pointRay(event: PointerEvent) {
    const bounds = renderer.domElement.getBoundingClientRect()
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      1 - ((event.clientY - bounds.top) / bounds.height) * 2
    )
    raycaster.setFromCamera(pointer, camera)
  }
  function hit(event: PointerEvent) {
    pointRay(event)
    const active = entries.filter(
      (entry) =>
        entry.phase === 'resting' && entry.included && entry.mesh.visible
    )
    const result = raycaster.intersectObjects(
      active.map((entry) => entry.mesh),
      true
    )[0]
    return result
      ? active.find((entry) => entry.book.id === result.object.userData.bookId)
      : undefined
  }
  function setHover(entry?: PhysicalBook) {
    if (hovered === entry?.book.id) return
    hovered = entry?.book.id
    host.classList.toggle('is-over-book', Boolean(entry))
    callbacks.onHover(entry?.book ?? null)
  }
  function wakeNeighbours(entry: PhysicalBook) {
    const point = entry.body.translation()
    for (const other of entries) {
      if (other === entry || !other.body.isDynamic()) continue
      const nearby = other.body.translation()
      if (Math.hypot(nearby.x - point.x, nearby.z - point.z) < 2.3)
        other.body.wakeUp()
    }
  }
  function pickUp(id: string) {
    if (
      !started ||
      selected ||
      entries.some(
        (entry) => entry.phase === 'pickup' || entry.phase === 'scattering'
      )
    )
      return
    const entry = entries.find(
      (book) => book.book.id === id && book.phase === 'resting' && book.included
    )
    if (!entry) return
    arrangementExempt.add(entry.book.id)
    void rememberMound()
    if (entry.guide) cancelBookRearrangement(entry.body)
    entry.guide = undefined
    entry.body.resetForces(true)
    entry.body.resetTorques(true)
    entry.phase = 'scattering'
    entry.start = performance.now()
    entry.duration = 280
    scatterAbove(
      entry.body,
      entries
        .filter(
          (other) =>
            other !== entry && other.phase === 'resting' && other.included
        )
        .map((other) => ({
          body: other.body,
          dimensions: visibleDimensions(other)
        }))
    )
    wakeNeighbours(entry)
    setHover()
  }
  function beginPickup(entry: PhysicalBook) {
    if (!entry.keepGroupedHome) {
      entry.home.copy(entry.mesh.position)
      entry.homeRotation.copy(entry.mesh.quaternion)
    }
    if (!entry.keepGroupedHome) {
      const heading = new THREE.Vector3(0, 0, 1).applyQuaternion(
        entry.mesh.quaternion
      )
      entry.homeRotation.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        THREE.MathUtils.clamp(
          Math.atan2(heading.x, heading.z),
          -Math.PI / 3,
          Math.PI / 3
        )
      )
    }
    entry.keepGroupedHome = false
    entry.scaling = undefined
    entry.fromScale = entry.scale
    entry.from.copy(entry.mesh.position)
    entry.fromRotation.copy(entry.mesh.quaternion)
    entry.phase = 'pickup'
    entry.start = performance.now()
    entry.duration = reducedMotion ? 180 : 580
    entry.body.resetForces(true)
    entry.body.resetTorques(true)
    entry.body.setBodyType(physics.RigidBodyType.KinematicPositionBased, true)
    wakeNeighbours(entry)
    setHover()
  }
  function down(event: PointerEvent) {
    if (!started || event.button !== 0 || selected) return
    if (
      (event.target as HTMLElement).closest(
        'button, a, input, select, textarea'
      )
    )
      return
    const entry = hit(event)
    if (!entry) return
    arrangementExempt.add(entry.book.id)
    void rememberMound()
    if (entry.guide) cancelBookRearrangement(entry.body)
    entry.guide = undefined
    entry.scaling = undefined
    entry.body.resetForces(true)
    entry.body.resetTorques(true)
    event.preventDefault()
    host.setPointerCapture(event.pointerId)
    const turnClearance =
      (Math.hypot(entry.dimensions.width, entry.dimensions.depth) *
        entry.scale) /
        2 +
      (entry.dimensions.height * entry.scale) / 2 +
      0.08
    dragPlane.constant = -Math.max(entry.mesh.position.y + 0.12, turnClearance)
    const center = entry.mesh.position.clone().project(camera)
    press = {
      entry,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      drag: false,
      screenOffset: pointer.clone().sub(new THREE.Vector2(center.x, center.y)),
      // Choose once for this grab. Contact can deflect the body, but its resting
      // direction stays stable instead of picking a new angle each frame.
      orientation: camera.quaternion
        .clone()
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1),
            THREE.MathUtils.degToRad((Math.random() * 2 - 1) * 15)
          )
        )
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            Math.PI / 2
          )
        )
    }
  }
  function move(event: PointerEvent) {
    if (!press) {
      if (
        (event.target as HTMLElement).closest(
          'button, a, input, select, textarea'
        )
      ) {
        setHover()
        return
      }
      setHover(selected ? undefined : hit(event))
      return
    }
    if (event.pointerId !== press.pointerId) return
    if (
      !press.drag &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5
    ) {
      press.drag = true
      press.entry.body.wakeUp()
      wakeNeighbours(press.entry)
      host.classList.add('is-dragging')
      setHover()
    }
    if (!press.drag) return
    event.preventDefault()
    pointRay(event)
    // Keep the point where the reader grabbed the book registered to the mouse
    // even as the book lifts onto a higher plane above its neighbors.
    pointer.sub(press.screenOffset)
    raycaster.setFromCamera(pointer, camera)
    if (raycaster.ray.intersectPlane(dragPlane, target)) {
      const horizontalLimit = mobile && !activeGroupId ? 2.65 : 4.18
      target.x = THREE.MathUtils.clamp(
        target.x,
        -horizontalLimit,
        horizontalLimit
      )
      target.z = THREE.MathUtils.clamp(target.z, -2.15, 2.15)
      const time = performance.now() / 1000
      if (press.target) updateDragTarget(press.target, target, time)
      else press.target = createDragTarget(target, time)
    }
  }
  function release(event: PointerEvent) {
    if (!press || press.pointerId !== event.pointerId) return
    const { entry, drag } = press
    press = undefined
    host.classList.remove('is-dragging')
    if (host.hasPointerCapture(event.pointerId))
      host.releasePointerCapture(event.pointerId)
    if (drag) {
      entry.body.resetForces(true)
      const velocity = entry.body.linvel()
      temp.set(velocity.x, velocity.y, velocity.z).clampLength(0, 3.2)
      entry.body.setLinvel(temp, true)
      animateBookScale(entry, entry.homeScale)
    } else if (event.type === 'pointercancel')
      animateBookScale(entry, entry.homeScale)
    else pickUp(entry.book.id)
  }
  function leave() {
    if (!press) setHover()
  }
  function resetMoundMemory(pristine: boolean) {
    moundMemory?.dispose()
    moundMemory = undefined
    moundTargets = undefined
    moundPristine = pristine
    const active = entries.filter((entry) => entry.phase !== 'leaving')
    if (!active.length) return
    const seeds = active.map((entry, index) => {
      const drop = getPileDrop(index, active.length, mobile, entry.dimensions)
      const orientation = new THREE.Quaternion(
        drop.rotation.x,
        drop.rotation.y,
        drop.rotation.z,
        drop.rotation.w
      )
      return {
        id: entry.book.id,
        dimensions: entry.dimensions,
        position: offscreenDropPosition(
          camera,
          entry.dimensions,
          orientation,
          new THREE.Vector3(drop.position.x, drop.position.y, drop.position.z)
        ),
        rotation: drop.rotation,
        delayMs: drop.delayMs
      }
    })
    moundMemory = createMoundMemory(physics, seeds, mobile ? 2.65 : 3.85)
  }
  function rememberMound() {
    if (!moundMemory || moundTargets) return moundTargets
    const memory = moundMemory
    const active = entries.filter((entry) => entry.phase !== 'leaving')
    // Freeze the untouched heap before a reader moves a book or changes layout.
    moundTargets = memory.remember(
      active.map((entry) => ({ id: entry.book.id, body: entry.body })),
      moundPristine &&
        !press &&
        !selected &&
        active.every((entry) => entry.phase === 'resting' && !entry.guide)
    )
    moundPristine = false
    void moundTargets.catch((err: unknown) => {
      if (!destroyed && moundMemory === memory)
        console.error('Unable to remember the free pile', err)
    })
    return moundTargets
  }
  function arrange(grouping: PileGrouping, groupId?: string) {
    requestedGrouping = grouping
    activeGroupId = grouping === 'free' ? undefined : groupId
    resize()
    arrangementExempt.clear()
    const revision = ++arrangementRevision
    if (!started || !entries.length) return
    const remembered = rememberMound()
    if (grouping === 'free') {
      if (remembered)
        void remembered.then(
          (targets) => {
            if (!destroyed && revision === arrangementRevision)
              applyArrangement(grouping, targets)
          },
          () => {}
        )
    } else applyArrangement(grouping)
  }
  function applyArrangement(
    grouping: PileGrouping,
    freeTargets?: ReadonlyMap<string, PileTarget>
  ) {
    const active = entries.filter((entry) => entry.phase !== 'leaving')
    const groups = buildPileGroups(
      active.map((entry) => entry.book),
      grouping
    )
    const focusedGroup = groups.find((group) => group.id === activeGroupId)
    const members = focusedGroup
      ? new Set(focusedGroup.books.map((book) => book.id))
      : undefined
    const focusArrangement = focusedGroup
      ? makeFocusArrangement(
          active
            .filter((entry) => members!.has(entry.book.id))
            .map((entry) => ({
              id: entry.book.id,
              dimensions: entry.dimensions
            }))
        )
      : undefined
    const arrangement = focusArrangement
      ? { targets: focusArrangement.targets, labels: [] as PileLabel[] }
      : makePileArrangement(
          active.map((entry) => ({
            id: entry.book.id,
            body: entry.body,
            dimensions: entry.dimensions
          })),
          groups,
          grouping,
          freeTargets
        )
    const now = simulationTime
    for (const [index, entry] of active.entries()) {
      entry.included = !members || members.has(entry.book.id)
      if (!entry.included) {
        parkBook(entry, index)
        continue
      }
      const destination = arrangement.targets.get(entry.book.id)
      entry.guide = undefined
      if (!destination) continue
      entry.homeScale = focusArrangement?.scale ?? 1
      entry.keepGroupedHome = entry.phase === 'scattering'
      entry.home.set(
        destination.position.x,
        destination.position.y,
        destination.position.z
      )
      entry.homeRotation.set(
        destination.rotation.x,
        destination.rotation.y,
        destination.rotation.z,
        destination.rotation.w
      )
      if (
        press?.entry === entry ||
        arrangementExempt.has(entry.book.id) ||
        (entry.phase !== 'resting' &&
          entry.phase !== 'dropping' &&
          entry.phase !== 'parking' &&
          entry.phase !== 'parked' &&
          entry.phase !== 'scattering' &&
          entry.phase !== 'pickup' &&
          entry.phase !== 'returning')
      )
        continue
      if (entry.phase !== 'resting') {
        entry.body.setEnabled(true)
        entry.body.collider(0).setEnabled(true)
        entry.mesh.visible = true
        entry.phase = 'resting'
        entry.keepGroupedHome = false
      }
      animateBookScale(entry, entry.homeScale)
      entry.guide = createBookRearrangement(
        entry.body,
        destination,
        now,
        reducedMotion
      )
      entry.body.wakeUp()
    }
    pileLabels = arrangement.labels
    labelLayer.replaceChildren(
      ...pileLabels.map((label) => {
        const element = document.createElement('button')
        element.type = 'button'
        element.className = 'physics-pile-label'
        element.dataset.pileGroupId = label.id
        element.setAttribute(
          'aria-label',
          `View ${label.count} books in ${label.label}`
        )
        element.addEventListener('click', () =>
          callbacks.onGroupSelect(label.id)
        )
        const name = document.createElement('span')
        name.textContent = label.label
        const count = document.createElement('small')
        count.textContent = `${label.count} books`
        element.append(name, count)
        return element
      })
    )
    projectLabels()
    if (!active.some((entry) => entry.book.id === focused && entry.included))
      focused = undefined
    setHover()
  }
  host.addEventListener('pointerdown', down)
  host.addEventListener('pointermove', move)
  host.addEventListener('pointerup', release)
  host.addEventListener('pointercancel', release)
  host.addEventListener('pointerleave', leave)
  function screenBounds(entry: PhysicalBook) {
    const box = new THREE.Box3().setFromObject(entry.mesh)
    const rect = renderer.domElement.getBoundingClientRect()
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          temp.set(x, y, z).project(camera)
          const px = rect.left + ((temp.x + 1) / 2) * rect.width
          const py = rect.top + ((1 - temp.y) / 2) * rect.height
          left = Math.min(left, px)
          right = Math.max(right, px)
          top = Math.min(top, py)
          bottom = Math.max(bottom, py)
        }
    return new DOMRect(left, top, right - left, bottom - top)
  }
  function advanceTransitions(now: number) {
    for (const entry of entries.slice()) {
      const progress = THREE.MathUtils.clamp(
        (now - entry.start) / entry.duration,
        0,
        1
      )
      if (entry.phase === 'dropping') {
        if (now >= entry.start) {
          entry.body.setEnabled(true)
          entry.body.setLinvel({ x: 0, y: -12, z: 0 }, true)
          entry.mesh.visible = true
          entry.body.wakeUp()
          entry.phase = 'resting'
        }
      } else if (entry.phase === 'scattering') {
        if (progress === 1) beginPickup(entry)
      } else if (entry.phase === 'returning') {
        setBookScale(
          entry,
          THREE.MathUtils.lerp(entry.fromScale, entry.homeScale, ease(progress))
        )
        position.lerpVectors(entry.from, entry.home, ease(progress))
        rotation.slerpQuaternions(
          entry.fromRotation,
          entry.homeRotation,
          ease(progress)
        )
        entry.body.setNextKinematicTranslation(position)
        entry.body.setNextKinematicRotation(rotation)
        if (progress === 1) {
          entry.body.setTranslation(entry.home, true)
          entry.body.setRotation(entry.homeRotation, true)
          entry.body.collider(0).setEnabled(true)
          entry.body.setBodyType(physics.RigidBodyType.Dynamic, true)
          entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
          entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
          entry.phase = 'resting'
        }
      } else if (entry.phase === 'parking') {
        position.lerpVectors(entry.from, entry.parkingTarget!, ease(progress))
        entry.body.setNextKinematicTranslation(position)
        entry.body.setNextKinematicRotation(entry.fromRotation)
        if (progress === 1) {
          entry.body.setTranslation(position, true)
          entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
          entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
          entry.body.setEnabled(false)
          entry.mesh.visible = false
          entry.phase = 'parked'
        }
      } else if (entry.phase === 'leaving') {
        position.copy(entry.from)
        position.x -= 13 * ease(progress)
        entry.body.setNextKinematicTranslation(position)
        if (progress === 1) {
          scene.remove(entry.mesh)
          disposeBookMesh(entry.mesh)
          world.removeRigidBody(entry.body)
          entries.splice(entries.indexOf(entry), 1)
        }
      } else if (entry.phase === 'pickup') {
        const extraction = Math.min(1, progress / 0.36)
        const lift = THREE.MathUtils.clamp((progress - 0.2) / 0.8, 0, 1)
        position.copy(entry.from)
        position.x -= 0.34 * smooth(extraction)
        position.lerp(pickupTarget, smooth(lift))
        rotation.slerpQuaternions(
          entry.fromRotation,
          pickupRotation,
          smooth(lift)
        )
        entry.body.setNextKinematicTranslation(position)
        entry.body.setNextKinematicRotation(rotation)
        if (progress > 0.43) {
          entry.body.collider(0).setEnabled(false)
          setBookScale(
            entry,
            THREE.MathUtils.lerp(
              entry.fromScale,
              1,
              smooth((progress - 0.43) / 0.57)
            )
          )
        }
        if (progress === 1) {
          entry.phase = 'selected'
          selected = entry.book.id
          entry.mesh.position.copy(position)
          entry.mesh.quaternion.copy(rotation)
          entry.mesh.updateMatrixWorld(true)
          host
            .querySelector<HTMLButtonElement>(
              `[data-physical-book-id="${entry.book.id}"]`
            )
            ?.focus({ preventScroll: true })
          callbacks.onSelect(entry.book, screenBounds(entry), true)
        }
      }
    }
  }
  function animate(now: number) {
    if (destroyed) return
    animationFrame = requestAnimationFrame(animate)
    if (!started) return
    const frameSeconds = Math.max(0, (now - previousTime) / 1000)
    accumulator = Math.min(0.1, accumulator + frameSeconds)
    previousTime = now
    while (accumulator >= PHYSICS_STEP) {
      simulationTime += PHYSICS_STEP
      advanceTransitions(now - accumulator * 1000 + PHYSICS_STEP * 1000)
      for (const entry of entries) {
        if (entry.scaling) {
          const progress = THREE.MathUtils.clamp(
            (simulationTime - entry.scaling.start) / entry.scaling.duration,
            0,
            1
          )
          setBookScale(
            entry,
            THREE.MathUtils.lerp(
              entry.scaling.from,
              entry.scaling.to,
              smooth(progress)
            )
          )
          if (progress === 1) entry.scaling = undefined
        }
        if (entry.guide) {
          if (applyBookRearrangement(entry.body, entry.guide, simulationTime))
            continue
          entry.guide = undefined
        }
        if (
          !entry.body.isEnabled() ||
          !entry.body.isDynamic() ||
          entry.phase === 'dropping'
        )
          continue
        entry.body.resetForces(false)
        entry.body.resetTorques(false)
        const held = press?.entry === entry && press.drag
        if (held && press) applyHeldBookTorque(entry.body, press.orientation)
        const limitX = mobile && requestedGrouping === 'free' ? 2.65 : 3.85
        applyPileBounds(
          entry.body,
          entry.dimensions,
          limitX,
          activeGroupId ? 2.3 : undefined
        )
        if (held && press?.target)
          applyBookDrag(entry.body, press.target, now / 1000 - accumulator)
      }
      impacts.beforeStep()
      world.step(impacts.queue)
      impacts.afterStep()
      accumulator -= PHYSICS_STEP
    }
    impacts.flush(now, callbacks.onImpact)
    for (const entry of entries) {
      if (entry.phase === 'selected' || entry.phase === 'parked') continue
      const point = entry.body.translation(),
        quaternion = entry.body.rotation()
      entry.mesh.position.set(point.x, point.y, point.z)
      entry.mesh.quaternion.set(
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w
      )
      if (point.y < -3 && entry.phase === 'resting') {
        entry.body.setTranslation(entry.home, true)
        entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      }
    }
    const activeBook =
      press?.entry ??
      entries.find(
        (entry) => entry.phase === 'scattering' || entry.phase === 'pickup'
      )
    const highlighted =
      activeBook ??
      entries.find(
        (entry) =>
          entry.book.id === (focused ?? hovered) &&
          entry.phase === 'resting' &&
          entry.included
      )
    if (activeBook) outlinedBook = activeBook
    const targetOpacity = activeBook ? 1 : 0
    const fade = reducedMotion
      ? 1
      : 1 - Math.exp(-frameSeconds / (activeBook ? 0.045 : 0.07))
    selectionOpacity += (targetOpacity - selectionOpacity) * fade
    if (
      outlinedBook &&
      outlinedBook.included &&
      outlinedBook.phase !== 'selected' &&
      outlinedBook.phase !== 'leaving'
    ) {
      selectionGlow.update(
        outlinedBook.mesh,
        outlinedBook.dimensions,
        selectionOpacity
      )
    } else selectionGlow.mesh.visible = false
    if (!activeBook && selectionOpacity < 0.001) outlinedBook = undefined
    focusPool.material.opacity +=
      ((highlighted ? 0.9 : 0) - focusPool.material.opacity) * 0.18
    if (highlighted) {
      focusPool.position.set(
        highlighted.mesh.position.x,
        0.007,
        highlighted.mesh.position.z
      )
      focusPool.scale.set(
        highlighted.dimensions.width * highlighted.scale * 2.15,
        highlighted.dimensions.depth * highlighted.scale * 1.55,
        1
      )
      focusPool.rotation.z = -new THREE.Euler().setFromQuaternion(
        highlighted.mesh.quaternion,
        'YXZ'
      ).y
    }
    renderer.render(scene, camera)
  }
  function releasePreparedBooks() {
    if (!prepared || !startRequested || destroyed) return
    const now = performance.now()
    if (!started) {
      started = true
      previousTime = now
      accumulator = 0
      world.forEachRigidBody((body) => {
        if (body.isFixed()) body.setEnabled(true)
      })
    }
    const waiting = entries.filter((entry) => entry.phase === 'prepared')
    for (const entry of waiting) {
      // The entry screen may stay open through a viewport change. Recalculate
      // the hidden spawn poses against the camera used at the actual start.
      const drop = getPileDrop(
        entry.order,
        waiting.length,
        mobile,
        entry.dimensions
      )
      entry.home.set(
        drop.position.x,
        entry.dimensions.height / 2 + 0.4,
        drop.position.z
      )
      entry.homeRotation.copy(drop.rotation)
      entry.from.copy(
        offscreenDropPosition(
          camera,
          entry.dimensions,
          entry.homeRotation,
          new THREE.Vector3(drop.position.x, drop.position.y, drop.position.z)
        )
      )
      entry.fromRotation.copy(entry.homeRotation)
      entry.body.setTranslation(entry.from, false)
      entry.body.setRotation(entry.homeRotation, false)
      entry.mesh.position.copy(entry.from)
      entry.mesh.quaternion.copy(entry.homeRotation)
      entry.start = now + 80 + drop.delayMs
      entry.phase = 'dropping'
    }
    resetMoundMemory(true)
    if (requestedGrouping !== 'free') arrange(requestedGrouping, activeGroupId)
  }
  animationFrame = requestAnimationFrame(animate)
  return {
    async setBooks(books) {
      const current = ++batch
      prepared = false
      arrangementRevision++
      moundMemory?.dispose()
      moundMemory = undefined
      moundTargets = undefined
      setHover()
      press = undefined
      outlinedBook = undefined
      selectionOpacity = 0
      selectionGlow.mesh.visible = false
      host.classList.remove('is-dragging')
      pileLabels = []
      labelLayer.replaceChildren()
      for (const entry of entries) {
        if (entry.phase === 'leaving') continue
        entry.guide = undefined
        entry.scaling = undefined
        entry.phase = 'leaving'
        entry.from.copy(entry.mesh.position)
        entry.start = performance.now() + entry.order * (reducedMotion ? 0 : 25)
        entry.duration = reducedMotion ? 100 : 300
        entry.body.setBodyType(
          physics.RigidBodyType.KinematicPositionBased,
          true
        )
        entry.body.collider(0).setEnabled(false)
      }
      let loaded: Awaited<ReturnType<typeof prepareBookMeshes>>
      try {
        loaded = await prepareBookMeshes(
          books,
          renderer.capabilities.getMaxAnisotropy(),
          [...(host.closest('.reading-room') ?? host).querySelectorAll('img')]
        )
      } catch (err) {
        if (destroyed || current !== batch) return
        throw err
      }
      if (destroyed || current !== batch) {
        loaded.forEach(({ mesh }) => disposeBookMesh(mesh))
        return
      }
      loaded.forEach(({ mesh, dimensions }, index) => {
        const drop = getPileDrop(index, loaded.length, mobile, dimensions)
        const home = new THREE.Vector3(
          drop.position.x,
          dimensions.height / 2 + 0.4,
          drop.position.z
        )
        const homeRotation = new THREE.Quaternion(
          drop.rotation.x,
          drop.rotation.y,
          drop.rotation.z,
          drop.rotation.w
        )
        const from = offscreenDropPosition(
          camera,
          dimensions,
          homeRotation,
          new THREE.Vector3(drop.position.x, drop.position.y, drop.position.z)
        )
        const body = makeBookBody(physics, world, dimensions, from)
        impacts.track(body)
        body.setRotation(drop.rotation, true)
        body.setEnabled(false)
        mesh.position.copy(from)
        mesh.quaternion.copy(homeRotation)
        mesh.visible = false
        scene.add(mesh)
        entries.push({
          book: books[index]!,
          mesh,
          dimensions,
          body,
          home,
          homeRotation,
          from,
          fromRotation: homeRotation.clone(),
          phase: 'prepared',
          scale: 1,
          homeScale: 1,
          fromScale: 1,
          included: true,
          order: index,
          start: 0,
          duration: 1
        })
      })
      // Upload covers and material textures while every prepared book stays
      // hidden, so the first falling books do not trigger those GPU uploads.
      const textures = new Set<THREE.Texture>()
      for (const { mesh } of loaded)
        mesh.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material]
          for (const material of materials) {
            if (!(material instanceof THREE.MeshStandardMaterial)) continue
            if (material.map) textures.add(material.map)
            if (material.bumpMap) textures.add(material.bumpMap)
          }
        })
      textures.forEach((texture) => renderer.initTexture(texture))
      renderer.initTexture(glowTexture)
      renderer.compile(scene, camera)
      // Exercise the first draw offscreen as well: this uploads geometry and
      // initializes the shadow programs without exposing or activating books.
      const warmup = new THREE.WebGLRenderTarget(1, 1)
      const culling = new Map<THREE.Mesh, boolean>()
      try {
        renderer.setRenderTarget(warmup)
        for (const { mesh } of loaded) {
          mesh.visible = true
          mesh.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return
            culling.set(object, object.frustumCulled)
            object.frustumCulled = false
          })
        }
        renderer.render(scene, camera)
        renderer.getContext().finish()
      } finally {
        for (const { mesh } of loaded) mesh.visible = false
        culling.forEach((value, mesh) => {
          mesh.frustumCulled = value
        })
        renderer.setRenderTarget(null)
        warmup.dispose()
      }
      prepared = true
      callbacks.onReady()
      releasePreparedBooks()
    },
    start() {
      if (startRequested) return
      startRequested = true
      releasePreparedBooks()
    },
    pickUp,
    arrange,
    setFire(enabled) {
      hearth.intensity = enabled ? 50 : 0
    },
    focus(id) {
      focused = id
    },
    select(id) {
      selected = id
      for (const entry of entries) {
        if (entry.book.id === id && entry.phase === 'selected')
          entry.mesh.visible = false
        else if (!id && entry.phase === 'selected') {
          entry.mesh.visible = true
          entry.fromScale = entry.scale
          entry.from.copy(entry.mesh.position)
          entry.fromRotation.copy(entry.mesh.quaternion)
          entry.home.y = Math.max(entry.home.y, 0.54)
          entry.start = performance.now()
          entry.duration = reducedMotion ? 140 : 580
          entry.phase = 'returning'
          if (!entry.included) parkBook(entry, entry.order)
        }
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      moundMemory?.dispose()
      batch++
      cancelAnimationFrame(animationFrame)
      observer.disconnect()
      host.removeEventListener('pointerdown', down)
      host.removeEventListener('pointermove', move)
      host.removeEventListener('pointerup', release)
      host.removeEventListener('pointercancel', release)
      host.removeEventListener('pointerleave', leave)
      entries.forEach((entry) => disposeBookMesh(entry.mesh))
      shadow.geometry.dispose()
      shadow.material.dispose()
      focusPool.geometry.dispose()
      focusPool.material.dispose()
      glowTexture.dispose()
      selectionGlow.dispose()
      windowLight.shadow.map?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      labelLayer.remove()
      impacts.dispose()
      world.free()
    }
  }
}

export default function TableScene(props: SceneProps) {
  const stage = useRef<HTMLDivElement>(null),
    frame = useRef<HTMLDivElement>(null)
  const runtime = useRef<Runtime | null>(null),
    latest = useRef(props)
  useLayoutEffect(() => {
    latest.current = props
  }, [props])
  const [hovered, setHovered] = useState<LibraryBook | null>(null)
  const [ready, setReady] = useState(false)
  const batchKey = props.books.map((book) => book.id).join('|')
  const visibleBooks = useMemo(
    () =>
      props.activeGroupId
        ? (buildPileGroups(props.books, props.grouping ?? 'free').find(
            (group) => group.id === props.activeGroupId
          )?.books ?? props.books)
        : props.books,
    [props.books, props.grouping, props.activeGroupId]
  )
  useEffect(() => {
    let cancelled = false
    void createRuntime(stage.current!, frame.current!, {
      onSelect: (...args) => latest.current.onSelect(...args),
      onHover: setHovered,
      onReady: () => {
        setReady(true)
        latest.current.onReady?.()
      },
      onImpact: (impact) => latest.current.onImpact?.(impact),
      onGroupSelect: (groupId) => latest.current.onGroupSelect?.(groupId)
    })
      .then((instance) => {
        if (cancelled) {
          instance.destroy()
          return
        }
        runtime.current = instance
        instance.setFire(latest.current.fire !== false)
        instance.arrange(
          latest.current.grouping ?? 'free',
          latest.current.activeGroupId
        )
        if (latest.current.started) instance.start()
        return instance.setBooks(latest.current.books)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('Unable to initialize the reading table', err)
        runtime.current?.destroy()
        runtime.current = null
        latest.current.onError?.()
      })
    return () => {
      cancelled = true
      runtime.current?.destroy()
      runtime.current = null
    }
  }, [])
  useEffect(() => {
    const instance = runtime.current
    if (!instance) return
    setReady(false)
    void instance.setBooks(latest.current.books).catch((err: unknown) => {
      if (runtime.current !== instance) return
      console.error('Unable to prepare the reading table', err)
      instance.destroy()
      runtime.current = null
      latest.current.onError?.()
    })
  }, [batchKey])
  useEffect(() => {
    if (props.started) runtime.current?.start()
  }, [props.started])
  useEffect(() => {
    runtime.current?.select(props.selectedId)
  }, [props.selectedId])
  useEffect(() => {
    runtime.current?.setFire(props.fire !== false)
  }, [props.fire])
  useEffect(() => {
    runtime.current?.arrange(props.grouping ?? 'free', props.activeGroupId)
  }, [props.grouping, props.activeGroupId])
  return (
    <div
      className='physics-room'
      ref={stage}
      data-physics-ready={ready || undefined}
      data-physics-started={(ready && props.started) || undefined}
    >
      <RoomBackdrop living rain={props.rain} fire={props.fire} />
      <div className='scene-frame physics-books-frame' ref={frame} />
      {props.started && hovered && !props.selectedId && (
        <div className='physics-book-caption'>
          {hovered.title}
          <small>{hovered.authors.join(', ')}</small>
        </div>
      )}
      <div className='physics-accessible-books' aria-label='Books on the table'>
        {props.started &&
          ready &&
          visibleBooks.map((book) => (
            <button
              key={book.id}
              data-physical-book-id={book.id}
              type='button'
              onClick={() => runtime.current?.pickUp(book.id)}
              onFocus={() => {
                runtime.current?.focus(book.id)
                setHovered(book)
              }}
              onBlur={() => {
                runtime.current?.focus()
                setHovered(null)
              }}
              aria-label={`Pick up ${book.title} by ${book.authors.join(', ')}`}
            >
              {book.title}
            </button>
          ))}
      </div>
    </div>
  )
}
