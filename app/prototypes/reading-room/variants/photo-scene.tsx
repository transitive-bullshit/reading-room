'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from 'react'

import type { LibraryBook } from '@/lib/library-schema'
import coverAspects from '@/data/cover-aspects.json'

import {
  afterHoursRainSize,
  afterHoursWindowPanes
} from './rain-window-geometry'
import type { BookImpact } from '../room-audio'
import type { PileGrouping } from './pile-groups'

import './photo-books.css'

export interface SceneProps {
  books: LibraryBook[]
  onSelect: (
    book: LibraryBook,
    origin?: DOMRect,
    pickupComplete?: boolean
  ) => void
  rain?: boolean
  fire?: boolean
  selectedId?: string
  onImpact?: (impact: BookImpact) => void
  grouping?: PileGrouping
  activeGroupId?: string
  onGroupSelect?: (groupId: string) => void
}

type Point = [number, number]
type Room = 'intimate' | 'grand' | 'after-hours'

interface Batch {
  serial: number
  key: string
  books: LibraryBook[]
  leaving: boolean
  revealed: boolean
}

const bookEntryDelay = 180
const bookStagger = 35
const bookExitDuration = 320

// These are tabletop coordinates, before the photograph's perspective is applied.
// Each row has enough clearance for the cover's rotated corners and page block.
const afterHoursPlaces = [
  { x: 40, y: 20, angle: -9, height: 246 },
  { x: 281, y: 24, angle: 6, height: 238 },
  { x: 525, y: 15, angle: -5, height: 248 },
  { x: 766, y: 29, angle: 8, height: 236 },
  { x: 30, y: 304, angle: 7, height: 242 },
  { x: 279, y: 305, angle: -6, height: 240 },
  { x: 523, y: 296, angle: 4, height: 244 },
  { x: 776, y: 307, angle: -7, height: 230 }
]

const quads = {
  intimate: [
    [460, 585],
    [1170, 622],
    [1090, 884],
    [240, 810]
  ],
  grand: [
    [615, 509],
    [1025, 510],
    [1350, 810],
    [300, 789]
  ],
  'after-hours': [
    [263, 405],
    [1260, 405],
    [1340, 787],
    [233, 775]
  ]
} satisfies Record<Room, [Point, Point, Point, Point]>

// Project a rectangle onto the photographed tabletop; covers share its vanishing point.
function projection(
  [p0, p1, p2, p3]: [Point, Point, Point, Point],
  height: number,
  scale = 1
) {
  const dx1 = p1[0] - p2[0],
    dx2 = p3[0] - p2[0],
    dx3 = p0[0] - p1[0] + p2[0] - p3[0]
  const dy1 = p1[1] - p2[1],
    dy2 = p3[1] - p2[1],
    dy3 = p0[1] - p1[1] + p2[1] - p3[1]
  const determinant = dx1 * dy2 - dx2 * dy1
  const g = (dx3 * dy2 - dx2 * dy3) / determinant
  const h = (dx1 * dy3 - dx3 * dy1) / determinant
  return `matrix3d(${(p1[0] - p0[0] + g * p1[0]) / 1000},${(p1[1] - p0[1] + g * p1[1]) / 1000},0,${g / 1000},${(p3[0] - p0[0] + h * p3[0]) / height},${(p3[1] - p0[1] + h * p3[1]) / height},0,${h / height},0,${-0.55 * scale},1,0,${p0[0]},${p0[1]},0,1)`
}

const angles = [-13, 7, -6, 15, 12, -9, 5, -12, -9, 14, -12, 6]
const offsets = [
  [25, -5],
  [9, 18],
  [-5, -10],
  [5, 6],
  [-12, 8],
  [15, -18],
  [4, 25],
  [-5, -20],
  [-2, 3],
  [17, -25],
  [-7, 16],
  [4, -14]
]

function Book({
  book,
  index,
  onSelect,
  onHover,
  material = false,
  selected = false,
  leaving = false
}: {
  book: LibraryBook
  index: number
  onSelect: SceneProps['onSelect']
  onHover: (book: LibraryBook | null) => void
  material?: boolean
  selected?: boolean
  leaving?: boolean
}) {
  const sourceAspect = (coverAspects as Record<string, number>)[book.id]
  const [loadedAspect, setAspect] = useState(0.66)
  const aspect = sourceAspect ?? loadedAspect
  const [materialFailed, setMaterialFailed] = useState(false)
  const place = material
    ? afterHoursPlaces[index % afterHoursPlaces.length]!
    : null
  const height = place?.height ?? 270
  const originalCover = book.cover.localPath ?? book.cover.remoteUrl ?? ''
  const cover =
    material && !materialFailed
      ? `/covers/textures/${book.id}.jpg`
      : originalCover
  const inspectLoadedCover = useCallback(
    (image: HTMLImageElement | null) => {
      // An SSR image can finish (or fail) before React attaches load handlers.
      if (!image?.complete) return
      if (image.naturalHeight) {
        setAspect(image.naturalWidth / image.naturalHeight)
      } else if (material && !materialFailed) {
        setMaterialFailed(true)
      }
    },
    [material, materialFailed]
  )

  return (
    <div
      className={`table-book-slot ${selected ? 'is-selected' : ''}`}
      style={
        {
          '--book-angle': `${place?.angle ?? angles[index % angles.length]}deg`,
          '--book-x': `${place?.x ?? (index % 4) * 248 + 15 + offsets[index % 12]![0]!}px`,
          '--book-y': `${place?.y ?? Math.floor(index / 4) * 282 + 8 + offsets[index % 12]![1]!}px`,
          '--book-height': `${height}px`,
          '--book-thickness': `${Math.min(34, 16 + (book.pageCount ?? 300) / 52)}px`,
          '--book-width': `${material ? height * aspect : Math.min(213, Math.max(152, height * aspect))}px`
        } as CSSProperties
      }
    >
      <div
        className='table-book-motion'
        style={{
          transitionDelay: `${(leaving ? 0 : bookEntryDelay) + index * bookStagger}ms`
        }}
      >
        <span className='table-book-focus-pool' aria-hidden='true' />
        <span className='table-book-ground-shadow' aria-hidden='true' />
        <button
          className='table-book'
          aria-label={`Pick up ${book.title} by ${book.authors.join(', ')}`}
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          onClick={(event) => {
            const surface =
              event.currentTarget.querySelector('.table-book-cover')
            onSelect(
              book,
              (surface ?? event.currentTarget).getBoundingClientRect()
            )
          }}
          onPointerEnter={() => onHover(book)}
          onPointerLeave={() => onHover(null)}
          onFocus={() => onHover(book)}
          onBlur={() => onHover(null)}
        >
          <span className='table-book-lower-board' aria-hidden='true' />
          <span className='table-book-pages' aria-hidden='true' />
          <span className='table-book-front-edge' aria-hidden='true' />
          <span className='table-book-side-edge' aria-hidden='true' />
          <span className='table-book-spine' aria-hidden='true'>
            <span>{book.title}</span>
          </span>
          <span className='table-book-cover'>
            <img
              ref={inspectLoadedCover}
              src={cover}
              alt=''
              draggable={false}
              onError={() => {
                if (material && !materialFailed) setMaterialFailed(true)
              }}
              onLoad={(event) => {
                const image = event.currentTarget
                if (image.naturalHeight)
                  setAspect(image.naturalWidth / image.naturalHeight)
              }}
            />
            <span className='table-book-light' aria-hidden='true' />
          </span>
        </button>
      </div>
    </div>
  )
}

function BookBatch({
  batch,
  onRemove,
  onReveal,
  onSelect,
  onHover,
  material,
  selectedId
}: {
  batch: Batch
  onRemove: (serial: number) => void
  onReveal: (serial: number) => void
  onHover: (book: LibraryBook | null) => void
  material: boolean
} & Pick<SceneProps, 'onSelect' | 'selectedId'>) {
  const { leaving, revealed, serial } = batch
  const count = batch.books.length
  useEffect(() => {
    if (!leaving && revealed) return
    const delay = leaving
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 120
        : bookExitDuration + Math.max(0, count - 1) * bookStagger
      : bookEntryDelay
    const timer = window.setTimeout(
      () => (leaving ? onRemove : onReveal)(serial),
      delay
    )
    return () => window.clearTimeout(timer)
  }, [leaving, revealed, serial, count, onRemove, onReveal])

  return (
    <div
      className='photo-book-batch'
      data-leaving={batch.leaving || undefined}
      inert={batch.leaving}
      aria-hidden={batch.leaving || undefined}
    >
      {batch.books.map((book, index) => (
        <Book
          key={book.id}
          book={book}
          index={index}
          onSelect={onSelect}
          onHover={onHover}
          material={material}
          selected={selectedId === book.id}
          leaving={batch.leaving}
        />
      ))}
    </div>
  )
}

function RainWindow({ room, enabled }: { room: Room; enabled: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pointer = useRef<Point | null>(null)
  const width = room === 'after-hours' ? afterHoursRainSize.width : 430
  const height = room === 'after-hours' ? afterHoursRainSize.height : 560
  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx || !enabled) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const drops = Array.from({ length: 130 }, (_, i) => ({
      x: (i * 139.39) % width,
      y: (i * 73.41) % height,
      speed: 0.5 + (i % 7) * 0.24,
      length: 5 + (i % 13) * 2,
      alpha: 0.1 + (i % 5) * 0.035
    }))
    let frame = 0,
      previous = 0
    const paint = (time: number) => {
      const delta = Math.min((time - previous) / 16.67 || 1, 3)
      previous = time
      ctx.clearRect(0, 0, width, height)
      ctx.save()
      if (room === 'after-hours') {
        ctx.beginPath()
        for (const pane of afterHoursWindowPanes) {
          pane.forEach(([x, y], index) => {
            if (index === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          })
          ctx.closePath()
        }
        ctx.clip()
      }
      for (const drop of drops) {
        if (!reduced.matches)
          drop.y = (drop.y + drop.speed * delta) % (height + 10)
        const close =
          pointer.current &&
          Math.hypot(drop.x - pointer.current[0], drop.y - pointer.current[1]) <
            64
        ctx.strokeStyle = `rgba(190,215,226,${close ? drop.alpha * 2.2 : drop.alpha})`
        ctx.lineWidth = close ? 1.5 : 0.7
        ctx.beginPath()
        ctx.moveTo(drop.x, drop.y)
        ctx.lineTo(drop.x - 1.3, drop.y + drop.length)
        ctx.stroke()
        ctx.fillStyle = `rgba(207,229,235,${drop.alpha})`
        ctx.beginPath()
        ctx.ellipse(drop.x, drop.y + drop.length, 0.9, 1.8, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
      if (!reduced.matches && !document.hidden)
        frame = requestAnimationFrame(paint)
    }
    const resume = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(paint)
    }
    resume()
    document.addEventListener('visibilitychange', resume)
    reduced.addEventListener('change', resume)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', resume)
      reduced.removeEventListener('change', resume)
      ctx.clearRect(0, 0, width, height)
    }
  }, [enabled, room, width, height])
  return (
    <canvas
      width={width}
      height={height}
      ref={canvas}
      className={`rain-window rain-window--${room}`}
      aria-label='Rain on the window'
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        pointer.current = [
          ((event.clientX - rect.left) / rect.width) * width,
          ((event.clientY - rect.top) / rect.height) * height
        ]
      }}
      onPointerLeave={() => {
        pointer.current = null
      }}
      style={{ opacity: enabled ? 1 : 0 }}
    />
  )
}

export function RoomBackdrop({
  room = 'after-hours',
  living = true,
  rain = true,
  fire = true
}: {
  room?: Room
  living?: boolean
  rain?: boolean
  fire?: boolean
}) {
  const stage = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [stoked, setStoked] = useState(false)
  const stokeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    const parent = stage.current
    if (!parent) return
    const update = () => {
      const scale = Math.max(
        parent.clientWidth / 1600,
        parent.clientHeight / 900
      )
      frame.current?.style.setProperty('--scene-scale', String(scale))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  useEffect(
    () => () => {
      if (stokeTimer.current) clearTimeout(stokeTimer.current)
    },
    []
  )

  return (
    <div className={`room-backdrop room-backdrop--${room}`} ref={stage}>
      <div className='scene-frame' ref={frame}>
        <img
          className='room-plate'
          src={`/rooms/${room}.jpg`}
          alt='A walnut table in an atmospheric mansion library, with a rainy window, emerald chairs and a glowing fireplace.'
          draggable={false}
          fetchPriority='high'
        />
        {living && (
          <>
            <RainWindow room={room} enabled={rain} />
            <div
              className={`room-firewash ${fire ? 'is-lit' : ''} ${stoked ? 'is-stoked' : ''}`}
              aria-hidden='true'
            />
            <button
              className={`hearth-hotspot hearth-hotspot--${room}`}
              aria-label='Stoke the fireplace'
              title='Stoke the fire'
              onClick={() => {
                setStoked(true)
                if (stokeTimer.current) clearTimeout(stokeTimer.current)
                stokeTimer.current = setTimeout(() => setStoked(false), 1800)
              }}
            >
              <span>Stoke the fire</span>
            </button>
            <div
              className={`room-flame room-flame--${room} ${fire ? 'is-lit' : ''}`}
              aria-hidden='true'
            />
          </>
        )}
      </div>
    </div>
  )
}

export function PhotoScene({
  books,
  onSelect,
  room,
  living = false,
  rain = true,
  fire = true,
  selectedId
}: SceneProps & { room: Room; living?: boolean }) {
  const stage = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const tabletop = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<LibraryBook | null>(null)
  const key = books.map((book) => book.id).join('|')
  const [batches, setBatches] = useState<Batch[]>(() => [
    { serial: 0, key, books, leaving: false, revealed: true }
  ])
  const current = batches[batches.length - 1]!
  const height = room === 'after-hours' ? 565 : 850

  // Keep outgoing DOM so a transition can retarget from its current position.
  // A new request becomes the only interactive batch, even during rapid paging.
  if (current.key !== key) {
    setBatches([
      ...batches
        .filter((batch) => batch.revealed)
        .map((batch) => ({ ...batch, leaving: true })),
      {
        serial: current.serial + 1,
        key,
        books,
        leaving: false,
        revealed: false
      }
    ])
  }

  const removeBatch = useCallback((serial: number) => {
    setBatches((previous) =>
      previous.filter((batch) => batch.serial !== serial || !batch.leaving)
    )
  }, [])

  const revealBatch = useCallback((serial: number) => {
    setBatches((previous) =>
      previous.map((batch) =>
        batch.serial === serial && !batch.revealed
          ? { ...batch, revealed: true }
          : batch
      )
    )
  }, [])

  useLayoutEffect(() => {
    const parent = stage.current
    if (!parent) return
    const update = () => {
      const scale = Math.max(
        parent.clientWidth / 1600,
        parent.clientHeight / 900
      )
      frame.current?.style.setProperty('--scene-scale', String(scale))
      const fit = Math.min(1, (parent.clientWidth / scale - 65) / 1200)
      const centerY = room === 'after-hours' ? 625 : 725
      const visibleQuad = quads[room].map(
        ([x, y]) =>
          [800 + (x - 800) * fit, centerY + (y - centerY) * fit] as Point
      ) as [Point, Point, Point, Point]
      if (tabletop.current)
        tabletop.current.style.transform = projection(visibleQuad, height, fit)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [room, height])

  const captionBook = books.some((book) => book.id === hovered?.id)
    ? hovered
    : null

  const renderBatches = () =>
    batches.map((batch) => (
      <BookBatch
        key={batch.serial}
        batch={batch}
        onRemove={removeBatch}
        onReveal={revealBatch}
        onSelect={onSelect}
        onHover={setHovered}
        material={room === 'after-hours'}
        selectedId={selectedId}
      />
    ))

  return (
    <div
      className={`photo-scene photo-scene--${room} ${living ? 'photo-scene--living' : ''}`}
      ref={stage}
      onDragStart={(event) => event.preventDefault()}
    >
      <RoomBackdrop room={room} living={living} rain={rain} fire={fire} />
      <div className='scene-frame photo-books-frame' ref={frame}>
        <div
          className='book-projection'
          ref={tabletop}
          style={{ height, transform: projection(quads[room], height) }}
        >
          {renderBatches()}
        </div>
      </div>
      <div className='mobile-books' aria-label='Books on the table'>
        {renderBatches()}
      </div>
      <div
        className={`book-caption ${captionBook ? 'is-visible' : ''}`}
        aria-live='polite'
      >
        <strong>{captionBook?.title}</strong>
        <span>{captionBook?.authors.join(' · ')}</span>
      </div>
    </div>
  )
}
