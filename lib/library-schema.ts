export type DatePrecision = 'year' | 'month' | 'day'

export interface LibraryDate {
  value: string
  precision: DatePrecision
  sourceText: string
}

export interface LibraryContributor {
  name: string
  role: string | null
  url: string | null
}

export interface LibraryBook {
  id: string
  title: string
  titleWithSeries: string
  authors: string[]
  contributors: LibraryContributor[]
  description: string | null
  cover: {
    remoteUrl: string | null
    localPath: string | null
    source: 'book-page' | 'shelf' | null
  }
  goodreadsUrl: string
  amazonUrl: string
  isbn: string | null
  isbn13: string | null
  asin: string | null
  publisher: string | null
  language: string | null
  format: string | null
  pageCount: number | null
  editionPublished: LibraryDate | null
  firstPublished: LibraryDate | null
  genres: string[]
  series: Array<{ title: string; position: string | null; url: string | null }>
  community: {
    rating: number | null
    ratingCount: number | null
  }
  personal: {
    rating: 1 | 2 | 3 | 4 | 5 | null
    dateAdded: LibraryDate | null
    datesRead: LibraryDate[]
    datesStarted: Array<LibraryDate | null>
    readCount: number | null
    shelves: string[]
    review: string | null
    reviewUrl: string | null
  }
  provenance: {
    shelfUrl: string
    shelfFetchedAt: string
    metadataUrl: string | null
    metadataFetchedAt: string | null
    metadataStatus: string
    dateStartedSourceText: string | null
  }
}

export interface LibraryData {
  schemaVersion: 1
  owner: { name: string; goodreadsId: string; shelfUrl: string }
  generatedAt: string
  summary: {
    books: number
    fiveStarBooks: number
    withDescriptions: number
    withBookPageCovers: number
    withLocalCovers: number
    withPersonalReadDates: number
    missingMetadataIds: string[]
  }
  books: LibraryBook[]
}
