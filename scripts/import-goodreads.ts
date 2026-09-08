import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  LibraryBook,
  LibraryData,
  LibraryDate
} from '../lib/library-schema'

interface ShelfRecord {
  id: string
  title: string
  author: string
  authorUrl?: string | null
  url: string
  coverUrl?: string | null
  asin?: string | null
  isbn?: string | null
  isbn13?: string | null
  averageRating?: string | null
  ratingsCount?: string | null
  pageCount?: string | null
  editionPublished?: string | null
  published?: string | null
  format?: string | null
  rating: number
  dateAdded?: string | null
  dateRead: string[]
  dateStarted?: string | null
  readCount?: string | null
  shelves: string[]
  review?: string | null
  reviewUrl?: string | null
}

interface EnrichmentRecord {
  id: string
  status?: string
  sourceUrl?: string
  canonicalUrl?: string
  fetchedAt?: string
  title?: string | null
  titleComplete?: string | null
  description?: string | null
  coverUrl?: string | null
  contributors?: Array<{
    name: string
    role?: string | null
    url?: string | null
  }>
  genres?: string[]
  series?: Array<{
    title: string
    position?: string | null
    url?: string | null
  }>
  publisher?: string | null
  language?: string | null
  format?: string | null
  pageCount?: number | null
  isbn?: string | null
  isbn13?: string | null
  asin?: string | null
  editionPublished?: string | null
  originalPublished?: string | null
  amazonSourceUrls?: string[]
}

interface CoverRecord {
  id: string
  localPath: string
  sourceUrl: string
}

const root = fileURLToPath(new URL('../', import.meta.url))
const months = new Map(
  [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ].map((name, index) => [name, String(index + 1).padStart(2, '0')])
)

function text(value: string | null | undefined): string | null {
  const result = value?.trim()
  return result && !/^(unknown|not set|write a review)$/i.test(result)
    ? result
    : null
}

function number(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null
  const result =
    typeof value === 'number' ? value : Number(value.replace(/,|\s*pp$/g, ''))
  return Number.isFinite(result) ? result : null
}

export function parseLibraryDate(
  input: string | null | undefined
): LibraryDate | null {
  const sourceText = text(input)
  if (!sourceText) return null
  if (/^\d{4}$/.test(sourceText)) {
    return { value: sourceText, precision: 'year', sourceText }
  }
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(sourceText)
  const named = /^([A-Z][a-z]{2}) (?:(\d{1,2}), )?(\d{4})$/.exec(sourceText)
  const year = iso?.[1] ?? named?.[3]
  const month = iso?.[2] ?? (named?.[1] ? months.get(named[1]) : undefined)
  const day = iso?.[3] ?? named?.[2]?.padStart(2, '0')
  assert(year && month, `Unrecognized Goodreads date: ${sourceText}`)
  assert(
    Number(month) >= 1 && Number(month) <= 12,
    `Invalid month: ${sourceText}`
  )
  if (!day) return { value: `${year}-${month}`, precision: 'month', sourceText }
  const value = `${year}-${month}-${day}`
  assert(
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
    `Invalid day: ${sourceText}`
  )
  return { value, precision: 'day', sourceText }
}

export function parseStartedDates(
  input: string | null | undefined
): Array<LibraryDate | null> {
  if (!input?.trim()) return []
  // Goodreads puts repeat-reading entries in the same table cell. Preserve
  // their order and explicit missing dates without inventing reading sessions.
  const entries = input.match(
    /not set|[A-Z][a-z]{2} (?:\d{1,2}, )?\d{4}|\b\d{4}\b/g
  )
  assert(entries, `Unrecognized reading-start dates: ${input}`)
  return entries.map(parseLibraryDate)
}

function readableAuthor(author: string): string {
  const comma = author.indexOf(',')
  return comma < 0
    ? author
    : `${author.slice(comma + 1).trim()} ${author.slice(0, comma).trim()}`
}

function amazonUrl(
  book: ShelfRecord,
  metadata: EnrichmentRecord | undefined
): string {
  for (const source of metadata?.amazonSourceUrls ?? []) {
    const parsed = new URL(source)
    const product = /\/(?:gp\/product|dp)\/([A-Z0-9]{10})(?:\/|$)/i.exec(
      parsed.pathname
    )
    if (/(^|\.)amazon\.com$/i.test(parsed.hostname) && product?.[1]) {
      return `https://www.amazon.com/dp/${product[1]}`
    }
  }
  const identifier =
    text(metadata?.asin) ??
    text(book.asin) ??
    text(metadata?.isbn) ??
    text(book.isbn)
  if (identifier && /^[A-Z0-9]{10}$/i.test(identifier)) {
    return `https://www.amazon.com/dp/${identifier}`
  }
  const query = `${book.title} ${readableAuthor(book.author)}`
  return `https://www.amazon.com/s?k=${encodeURIComponent(query)}`
}

async function readOptional<T>(filename: string): Promise<T | null> {
  const path = resolve(root, filename)
  return existsSync(path)
    ? (JSON.parse(await readFile(path, 'utf8')) as T)
    : null
}

async function main() {
  const shelf = await readOptional<{
    source: string
    fetchedAt: string
    books: ShelfRecord[]
  }>('data/goodreads-shelf-raw.json')
  assert(
    shelf && Array.isArray(shelf.books),
    'The Goodreads shelf export is required'
  )
  const metadata = new Map<string, EnrichmentRecord>()
  for (const filename of [
    'data/goodreads-enrichment.json',
    'data/goodreads-browser-enrichment.json'
  ]) {
    const source = await readOptional<{ books: EnrichmentRecord[] }>(filename)
    for (const record of source?.books ?? []) {
      // Browser enrichment can supplement a partial HTTP record. An error
      // record must never replace metadata already retrieved successfully.
      if (record.status && record.status !== 'ok') continue
      const defined = Object.fromEntries(
        Object.entries(record).filter(
          ([, value]) =>
            value != null &&
            value !== '' &&
            (!Array.isArray(value) || value.length > 0)
        )
      )
      metadata.set(record.id, {
        ...metadata.get(record.id),
        ...defined
      } as EnrichmentRecord)
    }
  }
  const manifest = await readOptional<{ covers: CoverRecord[] }>(
    'data/goodreads-cover-manifest.json'
  )
  const covers = new Map(
    (manifest?.covers ?? []).map((cover) => [cover.id, cover])
  )
  const ids = new Set<string>()
  const books = shelf.books.map((book): LibraryBook => {
    assert(
      book.id && !ids.has(book.id),
      `Duplicate or missing Goodreads edition ID: ${book.id}`
    )
    ids.add(book.id)
    assert(
      Number.isInteger(book.rating) && book.rating >= 0 && book.rating <= 5,
      `Invalid rating: ${book.id}`
    )
    const extra = metadata.get(book.id)
    const contributorRecords = extra?.contributors?.length
      ? extra.contributors
      : [
          {
            name: readableAuthor(book.author),
            role: 'Author',
            url: book.authorUrl
          }
        ]
    const contributors = contributorRecords.map((contributor) => ({
      name: contributor.name,
      role: text(contributor.role),
      url: text(contributor.url)
    }))
    const authors = contributors
      .filter((contributor) => contributor.role === 'Author')
      .map((contributor) => contributor.name)
    const cover = covers.get(book.id)
    if (cover)
      assert(
        existsSync(resolve(root, 'public', `.${cover.localPath}`)),
        `Missing local cover: ${cover.localPath}`
      )
    return {
      id: book.id,
      title: text(extra?.title) ?? book.title,
      titleWithSeries: text(extra?.titleComplete) ?? book.title,
      authors: authors.length ? authors : [readableAuthor(book.author)],
      contributors,
      description: text(extra?.description),
      cover: {
        remoteUrl: text(extra?.coverUrl) ?? text(book.coverUrl),
        localPath: cover?.localPath ?? null,
        source: text(extra?.coverUrl)
          ? 'book-page'
          : text(book.coverUrl)
            ? 'shelf'
            : null
      },
      goodreadsUrl: book.url,
      amazonUrl: amazonUrl(book, extra),
      isbn: text(extra?.isbn) ?? text(book.isbn),
      isbn13: text(extra?.isbn13) ?? text(book.isbn13),
      asin: text(extra?.asin) ?? text(book.asin),
      publisher: text(extra?.publisher),
      language: text(extra?.language),
      format: text(extra?.format) ?? text(book.format),
      pageCount: number(extra?.pageCount) ?? number(book.pageCount),
      // Shelf publication labels retain Goodreads' displayed precision.
      editionPublished: parseLibraryDate(
        text(book.editionPublished) ?? text(extra?.editionPublished)
      ),
      firstPublished: parseLibraryDate(
        text(book.published) ?? text(extra?.originalPublished)
      ),
      genres: extra?.genres ?? [],
      series: (extra?.series ?? []).map((series) => ({
        title: series.title,
        position: text(series.position),
        url: text(series.url)
      })),
      community: {
        rating: number(book.averageRating),
        ratingCount: number(book.ratingsCount)
      },
      personal: {
        rating: book.rating === 0 ? null : (book.rating as 1 | 2 | 3 | 4 | 5),
        dateAdded: parseLibraryDate(book.dateAdded),
        datesRead: book.dateRead
          .map(parseLibraryDate)
          .filter((date): date is LibraryDate => date !== null),
        datesStarted: parseStartedDates(book.dateStarted),
        readCount: number(book.readCount),
        shelves: book.shelves,
        review: text(book.review),
        reviewUrl: text(book.reviewUrl)
      },
      provenance: {
        shelfUrl: shelf.source,
        shelfFetchedAt: shelf.fetchedAt,
        metadataUrl: text(extra?.sourceUrl) ?? text(extra?.canonicalUrl),
        metadataFetchedAt: text(extra?.fetchedAt),
        metadataStatus: extra ? 'available' : 'unavailable',
        dateStartedSourceText: book.dateStarted ?? null
      }
    }
  })
  const library: LibraryData = {
    schemaVersion: 1,
    owner: {
      name: 'Travis Fischer',
      goodreadsId: '178989836',
      shelfUrl: shelf.source
    },
    generatedAt: new Date().toISOString(),
    summary: {
      books: books.length,
      fiveStarBooks: books.filter((book) => book.personal.rating === 5).length,
      withDescriptions: books.filter((book) => book.description).length,
      withBookPageCovers: books.filter(
        (book) => book.cover.source === 'book-page'
      ).length,
      withLocalCovers: books.filter((book) => book.cover.localPath).length,
      withPersonalReadDates: books.filter(
        (book) => book.personal.datesRead.length
      ).length,
      missingMetadataIds: books
        .filter((book) => book.provenance.metadataStatus !== 'available')
        .map((book) => book.id)
    },
    books
  }
  await writeFile(
    resolve(root, 'data/library.json'),
    `${JSON.stringify(library, null, 2)}\n`
  )
  console.log(JSON.stringify(library.summary, null, 2))
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main()
}
