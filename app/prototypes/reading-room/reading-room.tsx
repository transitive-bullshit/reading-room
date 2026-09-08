'use client'

import dynamic from 'next/dynamic'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import type { LibraryBook, LibraryData } from '@/lib/library-schema'

import { BookDetail } from './book-detail'
import { LibraryDrawer } from './library-drawer'
import { createRoomAudio, type BookImpact, type RoomAudio } from './room-audio'
import { RoomBackdrop, type SceneProps } from './variants/photo-scene'
import { buildPileGroups } from './variants/pile-groups'
import './reading-room.css'
import './picker.css'

const BookPile = dynamic(() => import('./variants/after-hours-pile'), {
  ssr: false,
  loading: () => <RoomBackdrop />
})
const BigBookPile = dynamic(() => import('./variants/after-hours-big-pile'), {
  ssr: false,
  loading: () => <RoomBackdrop />
})
const variants = [BookPile, BigBookPile]
const names = ['The\u00a0Pile', 'The\u00a0Big\u00a0Pile']
const subtitles = ['A few more chapters.', 'So many more chapters.']
const groupingOptions = [
  { value: 'free', label: 'Free pile' },
  { value: 'genre', label: 'Genre' },
  { value: 'author', label: 'Author' },
  { value: 'published', label: 'Published' }
] as const
// A varied display of 25 five-star books, not an ordering of equal ratings.
const displayIds = [
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
  '35009620',
  '35506021',
  '39706490',
  '21425079',
  '76620'
]

export function ReadingRoom({
  library,
  initialVariant
}: {
  library: LibraryData
  initialVariant: number
}) {
  const [variantIndex, setVariant] = useState(initialVariant)
  const variant = variantIndex < variants.length ? variantIndex : 0
  const [replay, setReplay] = useState(0)
  const [selected, setSelected] = useState<LibraryBook | null>(null)
  const [origin, setOrigin] = useState<DOMRect>()
  const [pickupComplete, setPickupComplete] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [rain, setRain] = useState(true)
  const [fire, setFire] = useState(true)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [ambientEnabled, setAmbientEnabled] = useState(true)
  const [grouping, setGrouping] =
    useState<NonNullable<SceneProps['grouping']>>('free')
  const [activeGroupId, setActiveGroupId] = useState<string>()
  const groupNavigation = useRef<HTMLElement>(null)
  const returnToGroups = useRef<HTMLButtonElement>(null)
  const focusBreadcrumb = useRef(false)
  const picker = useRef<HTMLElement>(null)
  const sounds = useRef<RoomAudio | null>(null)
  const favorites = useMemo(
    () =>
      displayIds
        .map((id) => library.books.find((book) => book.id === id))
        .filter((book): book is LibraryBook => Boolean(book)),
    [library]
  )
  const allFavorites = useMemo(
    () => [
      ...favorites,
      ...library.books.filter(
        (book) => book.personal.rating === 5 && !displayIds.includes(book.id)
      )
    ],
    [favorites, library]
  )
  const books = variant === 0 ? favorites : allFavorites
  const groups = useMemo(
    () => buildPileGroups(allFavorites, grouping),
    [allFavorites, grouping]
  )
  const activeGroup =
    variant === 1 && grouping !== 'free'
      ? groups.find((group) => group.id === activeGroupId)
      : undefined
  const visibleBooks = activeGroup?.books ?? books
  const Variant = variants[variant]!

  const replayBooks = useCallback(() => {
    focusBreadcrumb.current = false
    setActiveGroupId(undefined)
    setReplay((value) => value + 1)
  }, [])

  const selectGroup = useCallback((groupId: string) => {
    focusBreadcrumb.current = true
    setActiveGroupId(groupId)
  }, [])

  useLayoutEffect(() => {
    if (activeGroup && focusBreadcrumb.current) {
      returnToGroups.current?.focus({ preventScroll: true })
      focusBreadcrumb.current = false
    }
  }, [activeGroup])

  const switchVariant = useCallback(
    (index: number) => {
      if (index === variant) return
      focusBreadcrumb.current = false
      setActiveGroupId(undefined)
      setVariant(index)
      const url = new URL(window.location.href)
      url.searchParams.set('v', String(index + 1))
      window.history.replaceState(null, '', url)
    },
    [variant]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (
        event.defaultPrevented ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
        target.isContentEditable ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        selected ||
        libraryOpen
      )
        return
      const number = Number(event.key)
      if (number >= 1 && number <= variants.length) switchVariant(number - 1)
      else if (event.key === 'ArrowRight') {
        event.preventDefault()
        switchVariant((variant + 1) % variants.length)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        switchVariant((variant + variants.length - 1) % variants.length)
      } else if (event.key.toLowerCase() === 'r') replayBooks()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variant, switchVariant, selected, libraryOpen, replayBooks])

  useLayoutEffect(() => {
    const nav = picker.current
    if (!nav) return
    const position = () => {
      const item = nav.querySelector<HTMLElement>('[data-active]')
      const highlight = nav.querySelector<HTMLElement>(
        '.proto-picker-highlight'
      )
      if (item && highlight) {
        highlight.style.width = `${item.offsetWidth}px`
        highlight.style.transform = `translateX(${item.offsetLeft}px)`
      }
    }
    position()
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        nav.dataset.ready = ''
      })
    })
    window.addEventListener('resize', position)
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
      window.removeEventListener('resize', position)
    }
  }, [variant])

  useEffect(() => {
    const audio = createRoomAudio()
    sounds.current = audio
    const unlock = () => void audio.unlock()
    window.addEventListener('pointerdown', unlock, {
      capture: true,
      passive: true
    })
    window.addEventListener('keydown', unlock, true)
    return () => {
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('keydown', unlock, true)
      audio.dispose()
      sounds.current = null
    }
  }, [])

  useEffect(() => sounds.current?.setAudioEnabled(audioEnabled), [audioEnabled])
  useEffect(
    () => sounds.current?.setAmbientEnabled(ambientEnabled),
    [ambientEnabled]
  )

  const playImpact = useCallback((impact: BookImpact) => {
    sounds.current?.playImpact(impact)
  }, [])

  const selectBook = useCallback(
    (book: LibraryBook, rect?: DOMRect, lifted = false) => {
      setOrigin(rect)
      setPickupComplete(lifted)
      setSelected(book)
    },
    []
  )

  return (
    <main
      className={`reading-room reading-room--after-hours reading-room--${variant}${variant === 1 ? ' reading-room--big-pile' : ''}`}
    >
      <div className='room-stage'>
        <Variant
          key={`${variant}-${replay}`}
          books={books}
          onSelect={selectBook}
          selectedId={selected?.id}
          rain={rain}
          fire={fire}
          onImpact={playImpact}
          grouping={variant === 1 ? grouping : 'free'}
          activeGroupId={activeGroup?.id}
          onGroupSelect={selectGroup}
        />
        <div className='room-vignette' aria-hidden='true' />
      </div>
      <header className='room-header'>
        <div className='room-wordmark'>
          <span className='room-monogram' aria-hidden='true'>
            r.
          </span>
          <div>
            <span className='room-eyebrow'>A PERSONAL LIBRARY</span>
            <h1>Reading Room</h1>
          </div>
        </div>
        <button
          className='room-library-button'
          onClick={() => setLibraryOpen(true)}
        >
          <svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
            <path
              d='M5 4v16M10 4v16M15 5l4 14M3 20h18'
              stroke='currentColor'
              strokeWidth='1.4'
            />
          </svg>
          Browse library <span>{library.books.length}</span>
        </button>
      </header>
      <section className='room-introduction' aria-label='Room introduction'>
        <p className='room-eyebrow'>TRAVIS FISCHER’S COLLECTION</p>
        <h2>{subtitles[variant]}</h2>
        <p>Good books. A little quiet. All the time in the world.</p>
      </section>
      {variant === 1 && (
        <section
          className='room-grouping'
          aria-label='Arrange the books'
          ref={groupNavigation}
        >
          <div role='group' aria-label='Book grouping'>
            {groupingOptions.map((option) => (
              <button
                key={option.value}
                aria-pressed={grouping === option.value}
                onClick={() => {
                  focusBreadcrumb.current = false
                  setActiveGroupId(undefined)
                  setGrouping(option.value)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          {activeGroup ? (
            <nav className='room-group-breadcrumb' aria-label='Book category'>
              <ol>
                <li>
                  <button
                    ref={returnToGroups}
                    aria-label={`Return to all ${books.length} books grouped by ${groupingOptions.find((option) => option.value === grouping)?.label}`}
                    onClick={() => {
                      setActiveGroupId(undefined)
                      groupNavigation.current
                        ?.querySelector<HTMLButtonElement>(
                          '[aria-pressed="true"]'
                        )
                        ?.focus({ preventScroll: true })
                    }}
                  >
                    <span aria-hidden='true'>←</span>{' '}
                    {grouping === 'genre'
                      ? 'All genres'
                      : grouping === 'author'
                        ? 'All authors'
                        : 'All years'}
                  </button>
                </li>
                <li aria-hidden='true'>/</li>
                <li aria-current='page'>{activeGroup.label}</li>
              </ol>
            </nav>
          ) : grouping === 'free' ? (
            <span className='room-grouping-note'>
              A little room for serendipity.
            </span>
          ) : null}
          <span className='room-group-status' role='status'>
            {activeGroup
              ? `${activeGroup.books.length} books in ${activeGroup.label}`
              : `${books.length} books on the table`}
          </span>
        </section>
      )}
      <div className='room-footer'>
        <div className='room-spreads'>
          <span className='room-eyebrow'>
            ON THE TABLE{' '}
            <span className='room-stars' aria-label='Five stars'>
              ★★★★★
            </span>
          </span>
          <div>
            <button onClick={replayBooks} aria-label='Drop the books again'>
              ↻
            </button>
            <span>
              {visibleBooks.length}
              <i>books</i>
            </span>
          </div>
          <small>{visibleBooks.length} five-star reads</small>
        </div>
        <p className='room-hint'>
          {activeGroup
            ? 'A little closer. Click a book to open it.'
            : variant === 1 && grouping !== 'free'
              ? 'Choose a pile to explore. Click a book to open it.'
              : 'Drag the pile. Click a book to uncover it.'}
        </p>
        <div className='room-atmosphere'>
          <>
            <button
              aria-pressed={rain}
              onClick={() => setRain((value) => !value)}
            >
              Rain <span>{rain ? 'on' : 'off'}</span>
            </button>
            <button
              aria-pressed={fire}
              onClick={() => setFire((value) => !value)}
            >
              Firelight <span>{fire ? 'on' : 'off'}</span>
            </button>
          </>
          <button
            aria-pressed={audioEnabled}
            onClick={() => setAudioEnabled((value) => !value)}
            aria-label={
              audioEnabled ? 'Turn all audio off' : 'Turn all audio on'
            }
          >
            Audio <span>{audioEnabled ? 'on' : 'off'}</span>
          </button>
          <button
            aria-pressed={ambientEnabled}
            onClick={() => setAmbientEnabled((value) => !value)}
            aria-label={
              ambientEnabled
                ? 'Turn ambient audio off'
                : 'Turn ambient audio on'
            }
          >
            Ambient <span>{ambientEnabled ? 'on' : 'off'}</span>
          </button>
        </div>
      </div>
      <nav
        className='proto-picker'
        aria-label='Prototype variants'
        ref={picker}
      >
        <span className='proto-picker-highlight' aria-hidden='true' />
        {names.map((name, i) => (
          <button
            key={name}
            className='proto-picker-item'
            data-active={i === variant ? '' : undefined}
            aria-current={i === variant ? 'true' : undefined}
            onClick={() => switchVariant(i)}
          >
            {name}
          </button>
        ))}
        <span className='proto-picker-divider' aria-hidden='true' />
        <button
          className='proto-picker-item proto-picker-replay'
          aria-label='Replay animation (R)'
          onClick={replayBooks}
        >
          ↻
        </button>
      </nav>
      <BookDetail
        book={selected}
        origin={origin}
        pickupComplete={pickupComplete}
        onClose={() => setSelected(null)}
      />
      {libraryOpen && (
        <LibraryDrawer
          books={library.books}
          onSelect={(book) => selectBook(book)}
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </main>
  )
}
