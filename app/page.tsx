import library from '@/data/library.json'
import type { LibraryData } from '@/lib/library-schema'

import { ReadingRoom } from './reading-room/reading-room'

export default function HomePage() {
  return <ReadingRoom library={library as LibraryData} />
}
