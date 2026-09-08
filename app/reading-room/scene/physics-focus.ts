import type { PileTarget } from './physics-rearrange'
import type { BookBody, BookDimensions } from './physics-world'

export interface FocusBook {
  id: string
  dimensions: BookDimensions
}

function variation(id: string) {
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return ((hash >>> 0) % 1000) / 999 - 0.5
}

/** Fit complete covers in balanced rows, keeping their physical gaps clear. */
export function makeFocusArrangement(books: readonly FocusBook[]) {
  const targets = new Map<string, PileTarget>()
  if (!books.length) return { scale: 1, targets }
  const rowCount = Math.ceil(books.length / 6)
  const gapX = 0.13
  const gapZ = 0.2
  let cursor = 0
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const count = Math.ceil((books.length - cursor) / (rowCount - index))
    const row = books.slice(cursor, cursor + count).map((book) => {
      const yaw = variation(book.id) * 0.024
      const cosine = Math.abs(Math.cos(yaw))
      const sine = Math.abs(Math.sin(yaw))
      return {
        ...book,
        yaw,
        width: book.dimensions.width * cosine + book.dimensions.depth * sine,
        depth: book.dimensions.width * sine + book.dimensions.depth * cosine
      }
    })
    cursor += count
    return {
      books: row,
      width: row.reduce((sum, book) => sum + book.width, 0),
      depth: Math.max(...row.map((book) => book.depth))
    }
  })
  const depth = rows.reduce((sum, row) => sum + row.depth, 0)
  const centerSpan = depth - (rows[0]!.depth + rows.at(-1)!.depth) / 2
  const scale = Math.min(
    1,
    ...rows.map((row) => (9.2 - gapX * (row.books.length - 1)) / row.width),
    (6.25 - gapZ * (rows.length - 1)) / depth,
    rows.length > 1 ? (4.56 - gapZ * (rows.length - 1)) / centerSpan : 1
  )
  let z = -(depth * scale + gapZ * (rows.length - 1)) / 2
  for (const row of rows) {
    const rowDepth = row.depth * scale
    let x = -(row.width * scale + gapX * (row.books.length - 1)) / 2
    for (const book of row.books) {
      const width = book.width * scale
      targets.set(book.id, {
        position: {
          x: x + width / 2,
          y: (book.dimensions.height * scale) / 2 + 0.035,
          z: z + rowDepth / 2
        },
        rotation: {
          x: 0,
          y: Math.sin(book.yaw / 2),
          z: 0,
          w: Math.cos(book.yaw / 2)
        },
        delayMs: 0,
        mound: true
      })
      x += width + gapX
    }
    z += rowDepth + gapZ
  }
  return { scale, targets }
}

/** Resize the existing collider while preserving the book's handles and mass. */
export function resizeBookCollider(
  body: BookBody,
  dimensions: BookDimensions,
  scale: number
) {
  const radius = 0.012
  const collider = body.collider(0)
  collider.setHalfExtents({
    x: (dimensions.width / 2 - radius) * scale,
    y: (dimensions.height / 2 - radius) * scale,
    z: (dimensions.depth / 2 - radius) * scale
  })
  collider.setRoundRadius(radius * scale)
  collider.setMass(dimensions.mass)
  body.recomputeMassPropertiesFromColliders()
}
