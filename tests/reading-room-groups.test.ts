import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  buildPileGroups,
  type PileGrouping
} from '../app/prototypes/reading-room/variants/pile-groups'
import type { LibraryBook, LibraryData } from '../lib/library-schema'

const library = JSON.parse(
  readFileSync(new URL('../data/library.json', import.meta.url), 'utf8')
) as LibraryData

function book(id: string, changes: Partial<LibraryBook> = {}): LibraryBook {
  return { ...library.books[0]!, id, ...changes }
}

void test('each grouping keeps every original book exactly once and leaves metadata untouched', () => {
  const before = JSON.stringify(library.books)
  for (const mode of [
    'free',
    'genre',
    'author',
    'published'
  ] satisfies PileGrouping[]) {
    const groups = buildPileGroups(library.books, mode)
    assert.ok(groups.length > 0 && groups.length <= 6)
    assert.equal(new Set(groups.map((group) => group.id)).size, groups.length)
    const result = groups.flatMap((group) => group.books)
    assert.equal(result.length, library.books.length)
    assert.equal(new Set(result).size, library.books.length)
    assert.ok(result.every((entry) => library.books.includes(entry)))
    assert.deepEqual(groups, buildPileGroups(library.books, mode))
  }
  assert.equal(JSON.stringify(library.books), before)
  assert.deepEqual(buildPileGroups([], 'published'), [])
})

void test('author grouping ignores narrators and joins aliases only with an identical author URL', () => {
  const entries = [
    book('one', {
      authors: ['Reader Voice', 'A. Writer'],
      contributors: [
        {
          name: 'Reader Voice',
          role: 'Narrator',
          url: 'https://example.test/voice'
        },
        {
          name: 'A. Writer',
          role: 'Author',
          url: 'https://example.test/writer'
        }
      ]
    }),
    book('two', {
      authors: ['Alex Writer', 'Artist Name'],
      contributors: [
        {
          name: 'Alex Writer',
          role: 'Author',
          url: 'https://example.test/writer'
        },
        {
          name: 'Artist Name',
          role: 'Illustrator',
          url: 'https://example.test/artist'
        }
      ]
    }),
    book('three', {
      authors: ['A. Writer'],
      contributors: [
        {
          name: 'A. Writer',
          role: 'Author',
          url: 'https://example.test/different-writer'
        }
      ]
    })
  ]
  const groups = buildPileGroups(entries, 'author')
  assert.equal(groups.length, 2)
  assert.deepEqual(
    groups.find((group) => group.books.length === 2)?.books,
    entries.slice(0, 2)
  )
  assert.deepEqual(
    groups.find((group) => group.books.length === 1)?.books,
    entries.slice(2)
  )
  assert.ok(
    groups.every((group) => !/Reader Voice|Artist Name/.test(group.label))
  )
})

void test('the five-star author piles stay balanced and keep the most prolific author together', () => {
  const entries = library.books.filter((entry) => entry.personal.rating === 5)
  const groups = buildPileGroups(entries, 'author')
  assert.equal(groups.length, 6)
  assert.ok(
    groups.every(
      (group) => group.books.length >= 10 && group.books.length <= 20
    )
  )
  const carlo = groups.find((group) => group.label === 'Carlo Zen')
  assert.ok(carlo)
  assert.ok(
    carlo.books.every((entry) => entry.contributors[0]?.name === 'Carlo Zen')
  )
})

void test('publication piles use first publication, fall back to edition, and never split one year', () => {
  const date = (year: number) => ({
    value: String(year),
    precision: 'year' as const,
    sourceText: String(year)
  })
  const entries = Array.from({ length: 24 }, (_, index) =>
    book(String(index), {
      firstPublished: index % 2 ? null : date(1980 + Math.floor(index / 3)),
      editionPublished: date(1980 + Math.floor(index / 3))
    })
  )
  entries.push(
    book('first-before-edition', {
      firstPublished: date(1818),
      editionPublished: date(2015)
    })
  )
  entries.push(
    book('unknown', { firstPublished: null, editionPublished: null })
  )
  const groups = buildPileGroups(entries, 'published')
  assert.equal(groups.length, 6)
  assert.equal(groups[0]!.books[0]!.id, 'first-before-edition')
  assert.equal(groups.at(-1)!.label, 'Date unknown')
  const years = groups
    .slice(0, -1)
    .map((group) =>
      group.books.map((entry) =>
        Number((entry.firstPublished ?? entry.editionPublished)!.value)
      )
    )
  for (let index = 1; index < years.length; index++)
    assert.ok(Math.max(...years[index - 1]!) < Math.min(...years[index]!))
  assert.deepEqual(
    years.flat(),
    years.flat().sort((a, b) => a - b)
  )
})

void test('specific genres take priority over format shelves without changing source metadata', () => {
  const entries = [
    book('litrpg', { genres: ['Audiobook', 'Fiction', 'Fantasy', 'Litrpg'] }),
    book('space', { genres: ['Ebooks', 'Science Fiction', 'Space Opera'] }),
    book('military', {
      genres: ['Fiction', 'Space Opera', 'Military Science Fiction']
    }),
    book('general', { genres: ['Audiobook', 'Fiction'] })
  ]
  const groups = buildPileGroups(entries, 'genre')
  const labels = new Map(
    groups.flatMap((group) =>
      group.books.map((entry) => [entry.id, group.label])
    )
  )
  assert.equal(labels.get('litrpg'), 'LitRPG')
  assert.equal(labels.get('space'), 'Space opera')
  assert.equal(labels.get('military'), 'Military fiction')
  assert.equal(labels.get('general'), 'Other stories')
})
