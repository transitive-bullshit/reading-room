import type { Metadata } from 'next'

import library from '@/data/library.json'
import type { LibraryData } from '@/lib/library-schema'

import { ReadingRoom } from './reading-room'

export const metadata: Metadata = {
  title: 'Reading Room — The Piles',
  description:
    'Two studies in physical browsing: The Pile and The Big Pile, with all 86 five-star books.',
  robots: { index: false, follow: false }
}

export default async function ReadingRoomPage({
  searchParams
}: {
  searchParams: Promise<{ v?: string }>
}) {
  const value = Number((await searchParams).v)
  return (
    <ReadingRoom
      library={library as LibraryData}
      initialVariant={
        Number.isInteger(value) && value >= 1 && value <= 2 ? value - 1 : 0
      }
    />
  )
}
