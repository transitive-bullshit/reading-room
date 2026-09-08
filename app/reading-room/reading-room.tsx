'use client'

import dynamic from 'next/dynamic'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent
} from 'react'

import { ExpandingArrowButton } from '@/components/motion/expanding-arrow-button'
import { getFeaturedBooks } from '@/lib/featured-books'
import type { LibraryBook, LibraryData } from '@/lib/library-schema'

import { BookDetail } from './book-detail'
import { CreateRoomDialog } from './create-room-dialog'
import { createRoomAudio, type BookImpact, type RoomAudio } from './room-audio'
import { RoomBackdrop } from './scene/room-backdrop'
import type { SceneProps } from './scene/scene-props'
import { buildPileGroups } from './scene/pile-groups'
import './reading-room.css'

const TableScene = dynamic(() => import('./scene/table-scene'), {
  ssr: false,
  loading: () => <RoomBackdrop />
})
const groupingOptions = [
  { value: 'free', label: 'Free pile' },
  { value: 'genre', label: 'Genre' },
  { value: 'author', label: 'Author' },
  { value: 'published', label: 'Published' }
] as const

export function ReadingRoom({ library }: { library: LibraryData }) {
  const [entry, setEntry] = useState<'waiting' | 'opening'>('waiting')
  const [sceneReady, setSceneReady] = useState(false)
  const [audioReady, setAudioReady] = useState(false)
  const [audioPrepared, setAudioPrepared] = useState(false)
  const [sceneError, setSceneError] = useState(false)
  const [replay, setReplay] = useState(0)
  const [selected, setSelected] = useState<LibraryBook | null>(null)
  const [origin, setOrigin] = useState<DOMRect>()
  const [pickupComplete, setPickupComplete] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
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
  const keyboardEntry = useRef(false)
  const entryAttempt = useRef(0)
  const sounds = useRef<RoomAudio | null>(null)
  const books = useMemo(() => getFeaturedBooks(library.books), [library])
  const groups = useMemo(
    () => buildPileGroups(books, grouping),
    [books, grouping]
  )
  const activeGroup =
    grouping !== 'free'
      ? groups.find((group) => group.id === activeGroupId)
      : undefined
  const visibleBooks = activeGroup?.books ?? books
  const started = entry === 'opening' && sceneReady && audioReady
  const entryReady = sceneReady && audioPrepared
  const entryBusy = entry === 'opening' || (!sceneError && !entryReady)
  const entryLabel =
    entry === 'opening'
      ? 'Opening…'
      : sceneError
        ? 'Try again'
        : 'Enter the library'

  const enterLibrary = (event: MouseEvent<HTMLButtonElement>) => {
    const attempt = ++entryAttempt.current
    setAudioReady(false)
    keyboardEntry.current = event.currentTarget.matches(':focus-visible')
    // Resume synchronously in the gesture, before waiting for either preload.
    const ready = sounds.current?.unlock() ?? Promise.resolve()
    setEntry('opening')
    if (sceneError) {
      setSceneError(false)
      setReplay((value) => value + 1)
    }
    void ready.then(() => {
      if (entryAttempt.current === attempt) setAudioReady(true)
    })
  }

  const replayBooks = useCallback(() => {
    focusBreadcrumb.current = false
    setActiveGroupId(undefined)
    setReplay((value) => value + 1)
  }, [])

  const selectGroup = useCallback((groupId: string) => {
    focusBreadcrumb.current = true
    setActiveGroupId(groupId)
  }, [])

  const leaveGroup = useCallback(() => {
    focusBreadcrumb.current = false
    setActiveGroupId(undefined)
    groupNavigation.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.focus({ preventScroll: true })
  }, [])

  useLayoutEffect(() => {
    if (activeGroup && focusBreadcrumb.current) {
      returnToGroups.current?.focus({ preventScroll: true })
      focusBreadcrumb.current = false
    }
  }, [activeGroup])

  useLayoutEffect(() => {
    if (started && keyboardEntry.current) {
      groupNavigation.current
        ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
        ?.focus({ preventScroll: true })
      keyboardEntry.current = false
    }
  }, [started])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (
        event.defaultPrevented ||
        selected ||
        createOpen ||
        !started ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
        target.isContentEditable ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return
      if (event.key === 'Escape' && activeGroup) {
        event.preventDefault()
        leaveGroup()
      } else if (event.key.toLowerCase() === 'r') replayBooks()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeGroup, leaveGroup, selected, createOpen, replayBooks, started])

  useEffect(() => {
    const audio = createRoomAudio()
    let cancelled = false
    sounds.current = audio
    void audio.prepare().then(() => {
      if (!cancelled) setAudioPrepared(true)
    })
    return () => {
      cancelled = true
      audio.dispose()
      sounds.current = null
    }
  }, [])

  useEffect(() => sounds.current?.setAudioEnabled(audioEnabled), [audioEnabled])
  useEffect(
    () => sounds.current?.setAmbientEnabled(ambientEnabled),
    [ambientEnabled]
  )

  const prepareScene = useCallback(() => {
    setSceneReady(true)
    setSceneError(false)
  }, [])
  const failScene = useCallback(() => {
    entryAttempt.current++
    setAudioReady(false)
    setSceneReady(false)
    setSceneError(true)
    setEntry('waiting')
  }, [])

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
    <main className='reading-room' data-entered={started ? '' : undefined}>
      <div className='room-stage'>
        <TableScene
          key={replay}
          books={books}
          started={started}
          onReady={prepareScene}
          onError={failScene}
          onSelect={selectBook}
          selectedId={selected?.id}
          rain={rain}
          fire={fire}
          onImpact={playImpact}
          grouping={grouping}
          activeGroupId={activeGroup?.id}
          onGroupSelect={selectGroup}
        />
        <div className='room-vignette' aria-hidden='true' />
      </div>
      <header className='room-header'>
        <button
          type='button'
          className='room-wordmark'
          aria-label={
            started
              ? 'Reading Room — drop the books again'
              : 'Reading Room — enter the library'
          }
          disabled={!started && entryBusy}
          aria-busy={!started && entryBusy}
          onClick={started ? replayBooks : enterLibrary}
        >
          <img
            className='room-logo'
            src='/brand/logo.svg'
            alt='Reading Room'
            width='1178'
            height='180'
          />
          <img
            className='room-icon'
            src='/brand/icon.svg'
            alt='Reading Room'
            width='324'
            height='180'
          />
        </button>
        {started && (
          <ExpandingArrowButton
            size='compact'
            className='room-create-button'
            onClick={() => setCreateOpen(true)}
          >
            Create your own Reading Room
          </ExpandingArrowButton>
        )}
      </header>
      {!started && (
        <div className='room-entry'>
          <ExpandingArrowButton
            disabled={entryBusy}
            aria-busy={entryBusy}
            onClick={enterLibrary}
          >
            {entryLabel}
          </ExpandingArrowButton>
          {sceneError && (
            <p role='alert'>The room couldn’t open. Please try again.</p>
          )}
        </div>
      )}
      <div className='room-navigation'>
        <div className='room-heading'>
          <h1>A cozy home for your favorite books</h1>
          {started && (
            <p className='room-book-count'>{visibleBooks.length} books</p>
          )}
        </div>
        {started && (
          <section
            className='room-grouping'
            aria-label='Arrange the books'
            ref={groupNavigation}
          >
            <div className='room-group-controls'>
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
              <button
                className='room-replay'
                onClick={replayBooks}
                aria-label='Drop the books again'
                title='Drop the books again (R)'
              >
                ↻
              </button>
            </div>
            {activeGroup && (
              <nav className='room-group-breadcrumb' aria-label='Book category'>
                <ol>
                  <li>
                    <button
                      ref={returnToGroups}
                      aria-label={`Return to all ${books.length} books grouped by ${groupingOptions.find((option) => option.value === grouping)?.label}`}
                      onClick={leaveGroup}
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
            )}
            <span className='room-group-status' role='status'>
              {activeGroup
                ? `${visibleBooks.length} books in ${activeGroup.label}`
                : `${books.length} featured books`}
            </span>
          </section>
        )}
      </div>
      <div className='room-footer'>
        <nav className='room-socials' aria-label='Social links'>
          <a
            aria-label='GitHub repository'
            href='https://github.com/transitive-bullshit/reading-room'
            target='_blank'
            rel='noopener noreferrer'
          >
            <svg viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
              <path d='M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.14.68-3.8-1.34-3.8-1.34-.52-1.3-1.26-1.64-1.26-1.64-1.03-.7.08-.69.08-.69 1.14.08 1.74 1.17 1.74 1.17 1.01 1.73 2.65 1.23 3.3.94.1-.73.4-1.23.72-1.51-2.51-.29-5.15-1.26-5.15-5.56 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.16a10.8 10.8 0 0 1 5.63 0c2.15-1.46 3.09-1.16 3.09-1.16.62 1.55.23 2.69.12 2.98.72.79 1.15 1.79 1.15 3.02 0 4.31-2.64 5.27-5.16 5.55.41.35.77 1.03.77 2.08v3.1c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z' />
            </svg>
          </a>
          <a
            aria-label='Travis Fischer on X'
            href='https://x.com/transitive_bs'
            target='_blank'
            rel='noopener noreferrer'
          >
            <svg viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
              <path d='M18.9 2H22l-6.77 7.74L23.2 22h-6.24l-4.89-7.4L5.59 22H2.46l8.15-9.31L.8 2h6.4l4.42 6.77L18.9 2Zm-1.1 18h1.72L6.26 3.88H4.41L17.8 20Z' />
            </svg>
          </a>
        </nav>
        <div className='room-atmosphere'>
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
          <button
            aria-pressed={audioEnabled}
            onClick={() => {
              if (!audioEnabled && started) void sounds.current?.unlock()
              setAudioEnabled((value) => !value)
            }}
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
      <BookDetail
        book={selected}
        origin={origin}
        pickupComplete={pickupComplete}
        onClose={() => setSelected(null)}
      />
      {createOpen && <CreateRoomDialog onClose={() => setCreateOpen(false)} />}
    </main>
  )
}
