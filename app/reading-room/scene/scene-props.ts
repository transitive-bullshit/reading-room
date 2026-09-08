import type { LibraryBook } from '@/lib/library-schema'

import type { BookImpact } from '../room-audio'
import type { PileGrouping } from './pile-groups'

export interface SceneProps {
  books: LibraryBook[]
  started: boolean
  onReady?: () => void
  onError?: () => void
  onSelect: (
    book: LibraryBook,
    origin?: DOMRect,
    pickupComplete?: boolean
  ) => void
  rain?: boolean
  fire?: boolean
  selectedId?: string
  onImpact?: (impact: BookImpact) => void
  grouping?: PileGrouping
  activeGroupId?: string
  onGroupSelect?: (groupId: string) => void
}
