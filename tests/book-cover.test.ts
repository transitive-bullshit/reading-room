import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { getFeaturedBooks } from '../lib/featured-books'
import type { LibraryBook, LibraryData } from '../lib/library-schema'

// tsx's CommonJS loader preserves Next Image's default-export interop in Node.
const require = createRequire(import.meta.url)
const { BookCover } =
  require('../app/reading-room/book-cover.tsx') as typeof import('../app/reading-room/book-cover')
const library = JSON.parse(
  readFileSync(new URL('../data/library.json', import.meta.url), 'utf8')
) as LibraryData
const books = getFeaturedBooks(library.books)

function render(book: LibraryBook) {
  const html = renderToStaticMarkup(createElement(BookCover, { book }))
  const images = html.match(/<img\b[^>]*>/g) ?? []
  const texture = images.find((image) =>
    image.includes(`src="/covers/textures/${book.id}.jpg"`)
  )
  return {
    html,
    images,
    texture,
    original: images.find((image) => image !== texture)
  }
}

void test('a pending original retains the same-book texture from the first render without a pickup origin', () => {
  const cover = render(books[0]!)

  assert.equal(cover.images.length, 2)
  assert.ok(cover.texture, 'The texture is present before any loading callback')
  assert.ok(!/opacity:\s*0(?:;|")/.test(cover.texture))
  assert.ok(cover.original)
  assert.match(cover.original, /style="[^"]*opacity:0(?:;|")/)
  assert.ok(
    cover.original.includes(encodeURIComponent(books[0]!.cover.localPath!))
  )
})

void test('a book without an original URL keeps its textured cover and title fallback', () => {
  const book: LibraryBook = {
    ...books[0]!,
    cover: { ...books[0]!.cover, localPath: null, remoteUrl: null }
  }
  const cover = render(book)

  assert.equal(cover.images.length, 1)
  assert.ok(cover.texture)
  assert.equal(cover.original, undefined)
  assert.match(cover.html, /<span\b[^>]*>Hyperion<\/span>/)
})

void test('each book renders only its own textured and original cover sources', () => {
  const first = books[0]!
  const second = books[1]!
  assert.notEqual(first.id, second.id)
  assert.ok(first.cover.localPath && second.cover.localPath)
  assert.notEqual(first.cover.localPath, second.cover.localPath)

  for (const [book, other] of [
    [first, second],
    [second, first]
  ] as const) {
    const cover = render(book)
    assert.ok(cover.texture)
    assert.ok(cover.original)
    assert.ok(
      cover.original.includes(encodeURIComponent(book.cover.localPath!))
    )
    assert.ok(!cover.html.includes(`/covers/textures/${other.id}.jpg`))
    assert.ok(
      !cover.original.includes(encodeURIComponent(other.cover.localPath!))
    )
    assert.match(cover.original, /style="[^"]*opacity:0(?:;|")/)
  }
})
