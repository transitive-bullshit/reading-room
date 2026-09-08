import featuredBookIds from '../data/featured-book-ids.json'
import type { LibraryBook } from './library-schema'

/** The featured table has its own membership and order, independent of ratings. */
export function getFeaturedBooks(books: LibraryBook[]): LibraryBook[] {
  const byId = new Map(books.map((book) => [book.id, book]))
  return featuredBookIds.map((id) => {
    const book = byId.get(id)
    if (!book)
      throw new Error(`Featured book ${id} is missing from the library`)
    return book
  })
}
