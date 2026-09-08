import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import featuredBookIds from '../data/featured-book-ids.json'
import { getFeaturedBooks } from '../lib/featured-books'
import type { LibraryData } from '../lib/library-schema'

const library = JSON.parse(
  readFileSync(new URL('../data/library.json', import.meta.url), 'utf8')
) as LibraryData

void test('the featured collection contains 42 distinct books while preserving all 192 library records', () => {
  const source = structuredClone(library.books)
  const featured = getFeaturedBooks(source)
  assert.equal(featuredBookIds.length, 42)
  assert.equal(new Set(featuredBookIds).size, 42)
  assert.equal(featured.length, 42)
  assert.equal(source.length, 192)
  assert.deepEqual(source, library.books)
  assert.ok(featured.every((book) => source.includes(book)))
})

void test('featured membership and order stay fixed when ratings and source order change', () => {
  const source = structuredClone(library.books).reverse()
  const included = new Set(featuredBookIds)
  for (const book of source)
    book.personal.rating = included.has(book.id) ? 1 : 5
  assert.deepEqual(
    getFeaturedBooks(source).map((book) => book.id),
    featuredBookIds
  )
})

void test('the retained curated opening keeps its established order', () => {
  assert.deepEqual(featuredBookIds.slice(0, 23), [
    '77566',
    '43419431',
    '20518872',
    '15839976',
    '222697645',
    '40514364',
    '18630',
    '77711',
    '910863',
    '18373',
    '1126719',
    '54659324',
    '23168817',
    '25451264',
    '6136470',
    '123224254',
    '32109569',
    '36681361',
    '375802',
    '827',
    '39706490',
    '21425079',
    '76620'
  ])
})

void test("Heaven's River and every Tanya edition remain in the library but leave the featured collection", () => {
  const excluded = library.books.filter(
    (book) =>
      book.id === '42950440' ||
      book.authors.includes('Carlo Zen') ||
      /The Saga of Tanya the Evil|幼女戦記/.test(book.title)
  )
  assert.equal(excluded.length, 14)
  assert.ok(excluded.some((book) => book.language === 'Japanese'))
  assert.ok(excluded.every((book) => !featuredBookIds.includes(book.id)))
})

void test('all eight Tanya Huff books and Fourth Wing remain in the library but leave the featured collection', () => {
  const tanyaHuff = library.books.filter((book) =>
    book.authors.includes('Tanya Huff')
  )
  assert.equal(tanyaHuff.length, 8)
  assert.ok(tanyaHuff.every((book) => !featuredBookIds.includes(book.id)))
  const fourthWing = library.books.find((book) => book.id === '63219094')
  assert.equal(fourthWing?.title, 'Fourth Wing')
  assert.ok(!featuredBookIds.includes('63219094'))
})

void test('all ten Beginning After the End volumes remain in the library but leave the featured collection', () => {
  const series = library.books.filter((book) =>
    book.series.some((series) =>
      /The Beginning after the End/i.test(series.title)
    )
  )
  assert.equal(series.length, 10)
  assert.ok(series.every((book) => !featuredBookIds.includes(book.id)))
  assert.ok(
    getFeaturedBooks(library.books).every(
      (book) => !book.authors.includes('TurtleMe')
    )
  )
})

void test('only the first Mistborn and first Bobiverse book remain featured', () => {
  const featured = getFeaturedBooks(library.books)
  assert.deepEqual(
    featured
      .filter((book) => book.authors.includes('Brandon Sanderson'))
      .map((book) => book.id),
    ['123224254']
  )
  assert.deepEqual(
    featured
      .filter((book) =>
        book.series.some((series) => /Bobiverse/i.test(series.title))
      )
      .map((book) => book.id),
    ['32109569']
  )
  assert.ok(library.books.some((book) => book.id === '35506021'))
  assert.ok(library.books.some((book) => book.id === '23947089'))
})

void test("the first featured Old Man's War edition remains and both source records are retained", () => {
  const matches = (book: LibraryData['books'][number]) =>
    book.title === "Old Man's War" && book.authors.includes('John Scalzi')
  assert.equal(library.books.filter(matches).length, 2)
  assert.deepEqual(
    getFeaturedBooks(library.books)
      .filter(matches)
      .map((book) => book.id),
    ['51964']
  )
})

void test('only the first Hyperion remains featured while all four Cantos books stay in the library', () => {
  const cantos = library.books.filter((book) =>
    book.series.some(
      (series) =>
        series.url === 'https://www.goodreads.com/series/40461-hyperion-cantos'
    )
  )
  assert.deepEqual(
    new Set(cantos.map((book) => book.id)),
    new Set(['77566', '10429950', '3977', '11289'])
  )
  assert.deepEqual(
    getFeaturedBooks(library.books)
      .filter((book) => cantos.includes(book))
      .map((book) => book.id),
    ['77566']
  )
})

void test('a missing featured record reports its ID instead of silently changing the collection', () => {
  assert.throws(
    () => getFeaturedBooks(library.books.filter((book) => book.id !== '77566')),
    /Featured book 77566 is missing from the library/
  )
})
