import type { LibraryBook } from '@/lib/library-schema'

export type PileGrouping = 'free' | 'genre' | 'author' | 'published'

export interface PileGroup {
  id: string
  label: string
  books: LibraryBook[]
}

interface Bucket extends PileGroup {
  sortKey: string
}

const maximumGroups = 6
const compare = (a: string, b: string) => a.localeCompare(b, 'en')
const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ')
const surname = (name: string) => cleanName(name).split(' ').at(-1) ?? name

// Keep adjacent authors or publication years together. The partition with the
// smallest squared size error gives balanced piles without splitting an author
// or inventing a publication boundary inside a year.
function balanceBuckets(
  buckets: Bucket[],
  count: number,
  protectLarge = false
) {
  const groups = Math.min(count, buckets.length)
  if (!groups) return []
  const prefix = [0]
  for (const bucket of buckets)
    prefix.push(prefix[prefix.length - 1]! + bucket.books.length)
  const target = prefix[buckets.length]! / groups
  const largest = Math.max(...buckets.map((bucket) => bucket.books.length))
  const costs = Array.from({ length: groups + 1 }, () =>
    Array<number>(buckets.length + 1).fill(Infinity)
  )
  const starts = Array.from({ length: groups + 1 }, () =>
    Array<number>(buckets.length + 1).fill(0)
  )
  costs[0]![0] = 0
  for (let group = 1; group <= groups; group++) {
    for (let end = group; end <= buckets.length; end++) {
      for (let start = group - 1; start < end; start++) {
        const size = prefix[end]! - prefix[start]!
        const combinesProlific =
          protectLarge &&
          end - start > 1 &&
          largest >= target * 0.65 &&
          buckets
            .slice(start, end)
            .some((bucket) => bucket.books.length === largest)
        const cost =
          costs[group - 1]![start]! +
          (size - target) ** 2 +
          (combinesProlific ? target ** 2 * 20 : 0)
        if (cost < costs[group]![end]!) {
          costs[group]![end] = cost
          starts[group]![end] = start
        }
      }
    }
  }
  const result: Bucket[][] = []
  let end = buckets.length
  for (let group = groups; group > 0; group--) {
    const start = starts[group]![end]!
    result.unshift(buckets.slice(start, end))
    end = start
  }
  return result
}

function authorGroups(books: LibraryBook[]): PileGroup[] {
  // Different names are aliases only when their contributor URL is identical.
  const namesByUrl = new Map<string, Map<string, number>>()
  for (const book of books) {
    for (const contributor of book.contributors) {
      if (contributor.role?.toLowerCase() !== 'author' || !contributor.url)
        continue
      const names = namesByUrl.get(contributor.url) ?? new Map<string, number>()
      const name = cleanName(contributor.name)
      names.set(name, (names.get(name) ?? 0) + 1)
      namesByUrl.set(contributor.url, names)
    }
  }
  const buckets = new Map<string, Bucket>()
  for (const book of books) {
    const author = book.contributors.find(
      (person) => person.role?.toLowerCase() === 'author'
    )
    const rawName = cleanName(
      author?.name ?? book.authors[0] ?? 'Unknown author'
    )
    const id = author?.url ?? `name:${rawName}`
    const names = author?.url ? namesByUrl.get(author.url) : undefined
    const label = names
      ? [...names].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))[0]![0]
      : rawName
    const bucket = buckets.get(id) ?? {
      id,
      label,
      sortKey: surname(label),
      books: []
    }
    bucket.books.push(book)
    buckets.set(id, bucket)
  }
  const ordered = [...buckets.values()].sort(
    (a, b) =>
      compare(a.sortKey, b.sortKey) ||
      compare(a.label, b.label) ||
      compare(a.id, b.id)
  )
  return balanceBuckets(ordered, maximumGroups, true).map((range) => ({
    id: `author:${range.map((bucket) => bucket.id).join('|')}`,
    label:
      range.length === 1
        ? range[0]!.label
        : `${range[0]!.sortKey} – ${range[range.length - 1]!.sortKey}`,
    books: range.flatMap((bucket) => bucket.books)
  }))
}

function publishedGroups(books: LibraryBook[]): PileGroup[] {
  const byYear = new Map<number, Bucket>()
  const undated: LibraryBook[] = []
  for (const book of books) {
    const value = book.firstPublished?.value ?? book.editionPublished?.value
    const match = value?.match(/^(\d{4})(?:-|$)/)
    if (!match) {
      undated.push(book)
      continue
    }
    const year = Number(match[1])
    const label = String(year)
    const bucket = byYear.get(year) ?? {
      id: label,
      label,
      sortKey: label,
      books: []
    }
    bucket.books.push(book)
    byYear.set(year, bucket)
  }
  const ordered = [...byYear]
    .sort((a, b) => a[0] - b[0])
    .map(([, bucket]) => bucket)
  const groups = balanceBuckets(
    ordered,
    maximumGroups - Number(undated.length > 0)
  ).map((range) => {
    const first = range[0]!.label
    const last = range[range.length - 1]!.label
    return {
      id: `published:${first}:${last}`,
      label: first === last ? first : `${first}–${last}`,
      books: range.flatMap((bucket) => bucket.books)
    }
  })
  if (undated.length)
    groups.push({
      id: 'published:unknown',
      label: 'Date unknown',
      books: undated
    })
  return groups
}

// These featured titles emphasize scientific ideas and discovery even though
// their source shelves also include Space Opera. Keep the source genres intact.
const featuredGenreOverrides = new Map<string, string>([
  ['40514364', 'Science fiction'], // Children of Time: evolution and alien intelligence.
  ['25451264', 'Science fiction'], // Death's End: cosmology, alongside its trilogy.
  ['39706490', 'Science fiction'], // Dragon's Egg: life under neutron-star physics.
  ['112520', 'Science fiction'], // Rama II: investigation of an alien artifact.
  ['32109569', 'Science fiction'] // We Are Legion: self-replicating probes and engineering.
])

// More specific shelves win over broad shelves. Format labels such as Audiobook,
// Ebooks and Fiction never determine a genre pile; original metadata stays intact.
function primaryGenre(book: LibraryBook) {
  const curated = featuredGenreOverrides.get(book.id)
  if (curated) return curated
  // Present the Red Rising saga as Fantasy while retaining its imported shelves.
  if (
    book.series.some(
      (series) =>
        series.url === 'https://www.goodreads.com/series/117100-red-rising-saga'
    )
  )
    return 'Fantasy'
  const genres = new Set(book.genres.map((genre) => genre.toLowerCase()))
  if (genres.has('litrpg')) return 'LitRPG'
  if (genres.has('light novel') || genres.has('manga') || genres.has('manhwa'))
    return 'Light novels'
  if (genres.has('military science fiction') || genres.has('military fiction'))
    return 'Military fiction'
  if (genres.has('classics')) return 'Classics'
  if (
    genres.has('high fantasy') ||
    genres.has('epic fantasy') ||
    genres.has('urban fantasy')
  )
    return 'Fantasy'
  if (genres.has('space opera')) return 'Space opera'
  if (genres.has('science fiction')) return 'Science fiction'
  if (genres.has('fantasy')) return 'Fantasy'
  const generic = new Set([
    'fiction',
    'audiobook',
    'ebooks',
    'novels',
    'adult',
    'young adult',
    'book club',
    'speculative fiction',
    'science fiction fantasy'
  ])
  return (
    book.genres.find((genre) => !generic.has(genre.toLowerCase())) ??
    'Other stories'
  )
}

function genreGroups(books: LibraryBook[]): PileGroup[] {
  const buckets = new Map<string, PileGroup>()
  for (const book of books) {
    const label = primaryGenre(book)
    const bucket = buckets.get(label) ?? {
      id: `genre:${label}`,
      label,
      books: []
    }
    bucket.books.push(book)
    buckets.set(label, bucket)
  }
  const result = [...buckets.values()]
  // Small categories share a clearly named pile, keeping every classification
  // visible while reserving separate space for the most populated genres.
  while (result.length > maximumGroups) {
    result.sort(
      (a, b) => a.books.length - b.books.length || compare(a.label, b.label)
    )
    const first = result.shift()!
    const second = result.shift()!
    result.push({
      id: `${first.id}|${second.id}`,
      label: `${first.label} & ${second.label}`,
      books: [...first.books, ...second.books]
    })
  }
  return result.sort((a, b) => compare(a.label, b.label))
}

export function buildPileGroups(
  books: LibraryBook[],
  grouping: PileGrouping
): PileGroup[] {
  if (!books.length) return []
  switch (grouping) {
    case 'author':
      return authorGroups(books)
    case 'published':
      return publishedGroups(books)
    case 'genre':
      return genreGroups(books)
    default:
      return [{ id: 'free', label: 'Free pile', books: [...books] }]
  }
}
