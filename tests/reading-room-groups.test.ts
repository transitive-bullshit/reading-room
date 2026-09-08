import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  buildPileGroups,
  type PileGrouping
} from '../app/reading-room/scene/pile-groups'
import { getFeaturedBooks } from '../lib/featured-books'
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

void test('the featured author piles stay balanced and keep the most prolific author together', () => {
  const entries = getFeaturedBooks(library.books)
  const groups = buildPileGroups(entries, 'author')
  assert.equal(groups.length, 6)
  assert.ok(
    groups.every((group) => group.books.length >= 6 && group.books.length <= 8)
  )
  const hamilton = groups.find((group) => group.label === 'Peter F. Hamilton')
  assert.ok(hamilton)
  assert.equal(hamilton.books.length, 7)
  assert.ok(
    hamilton.books.every((entry) => entry.authors.includes('Peter F. Hamilton'))
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
    ...['High Fantasy', 'Epic Fantasy', 'Urban Fantasy'].map((genre) =>
      book(genre, { genres: ['Science Fiction', 'Fiction', 'Fantasy', genre] })
    ),
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
  for (const genre of ['High Fantasy', 'Epic Fantasy', 'Urban Fantasy'])
    assert.equal(labels.get(genre), 'Fantasy')
  assert.equal(labels.get('general'), 'Other stories')
})

void test('five curated discovery-led titles move to science fiction while galactic sagas remain space opera', () => {
  const entries = getFeaturedBooks(library.books)
  const before = JSON.stringify(entries)
  const labels = new Map(
    buildPileGroups(entries, 'genre').flatMap((group) =>
      group.books.map((entry) => [entry.id, group.label])
    )
  )
  const moved = entries.filter(
    (entry) =>
      entry.genres.includes('Space Opera') &&
      labels.get(entry.id) === 'Science fiction'
  )
  assert.deepEqual(
    new Set(moved.map((entry) => entry.id)),
    new Set([
      '40514364', // Children of Time
      '25451264', // Death's End
      '39706490', // Dragon's Egg
      '112520', // Rama II
      '32109569' // We Are Legion
    ])
  )
  // A Hard Science Fiction shelf alone must not move these galactic sagas.
  assert.equal(labels.get('1126719'), 'Space opera') // House of Suns
  assert.equal(labels.get('50154683'), 'Space opera') // The Saints of Salvation
  assert.equal(labels.get('18630'), 'Space opera') // The Player of Games
  assert.equal(labels.get('222697645'), 'Science fiction') // Project Hail Mary
  assert.equal(JSON.stringify(entries), before)
})

void test('the entire Red Rising saga is curated as Fantasy without changing imported genres', () => {
  const sagaIds = [
    '15839976',
    '21425079',
    '18966806',
    '33257757',
    '29226553',
    '61755286'
  ]
  const saga = sagaIds.map((id) =>
    library.books.find((book) => book.id === id)!
  )
  const originalGenres = saga.map((book) => [...book.genres])
  const groups = buildPileGroups(saga, 'genre')

  assert.equal(groups.length, 1)
  assert.equal(groups[0]!.label, 'Fantasy')
  assert.deepEqual(groups[0]!.books, saga)
  assert.deepEqual(
    saga.map((book) => book.genres),
    originalGenres
  )
  assert.ok(saga.every((book) => book.genres.includes('Science Fiction')))
})

void test('the featured table has separate fantasy and science-fiction piles with the curated memberships', () => {
  const groups = buildPileGroups(getFeaturedBooks(library.books), 'genre')
  assert.deepEqual(
    Object.fromEntries(
      groups.map((group) => [group.label, group.books.length])
    ),
    {
      Classics: 8,
      Fantasy: 5,
      LitRPG: 3,
      'Military fiction': 4,
      'Science fiction': 10,
      'Space opera': 12
    }
  )
  const fantasy = groups.find((group) => group.label === 'Fantasy')!
  assert.ok(fantasy.books.some((entry) => entry.id === '36681361')) // Jade City
  const lostMetal = library.books.find((entry) => entry.id === '23947089')!
  assert.equal(buildPileGroups([lostMetal], 'genre')[0]?.label, 'Fantasy')
})
