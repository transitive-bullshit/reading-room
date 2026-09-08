'use client'

import Image from 'next/image'
import {
  useDeferredValue,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import type { LibraryBook } from '@/lib/library-schema'

import './library-drawer.css'

interface LibraryDrawerProps {
  books: LibraryBook[]
  onSelect: (book: LibraryBook) => void
  onClose: () => void
}

type LibrarySort = 'title' | 'rating' | 'read'

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
const drawerEase = 'cubic-bezier(0.32, 0.72, 0, 1)'

function searchable(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en')
}

const searchIcon = (
  <svg
    aria-hidden='true'
    width='20'
    height='20'
    viewBox='0 0 24 24'
    fill='none'
  >
    <circle
      cx='10.5'
      cy='10.5'
      r='6.5'
      stroke='currentColor'
      strokeWidth='1.3'
    />
    <path d='m15.5 15.5 5 5' stroke='currentColor' strokeWidth='1.3' />
  </svg>
)

export function LibraryDrawer({
  books,
  onSelect,
  onClose
}: LibraryDrawerProps) {
  const titleId = useId()
  const searchId = useId()
  const filterId = useId()
  const [query, setQuery] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [sort, setSort] = useState<LibrarySort>('title')
  const deferredQuery = useDeferredValue(query)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<Animation | null>(null)
  const aliveRef = useRef(false)
  const closingRef = useRef(false)
  const backdropPointerRef = useRef(false)
  const motionRef = useRef({ spatial: true, duration: 240 })

  const catalog = useMemo(
    () =>
      books.map((book) => ({
        book,
        search: searchable(`${book.titleWithSeries} ${book.authors.join(' ')}`),
        lastRead: book.personal.datesRead.reduce(
          (latest, date) => (date.value > latest ? date.value : latest),
          ''
        )
      })),
    [books]
  )
  const favoritesCount = useMemo(
    () => books.filter((book) => book.personal.rating === 5).length,
    [books]
  )
  const results = useMemo(() => {
    const terms = searchable(deferredQuery).trim().split(/\s+/).filter(Boolean)
    return catalog
      .filter(
        (entry) =>
          (!favoritesOnly || entry.book.personal.rating === 5) &&
          terms.every((term) => entry.search.includes(term))
      )
      .sort((a, b) => {
        if (sort === 'rating') {
          const difference =
            (b.book.personal.rating ?? -1) - (a.book.personal.rating ?? -1)
          if (difference) return difference
        }
        if (sort === 'read' && a.lastRead !== b.lastRead) {
          return b.lastRead.localeCompare(a.lastRead)
        }
        return collator.compare(a.book.title, b.book.title)
      })
  }, [catalog, deferredQuery, favoritesOnly, sort])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    const panel = panelRef.current
    if (!dialog || !panel) return
    aliveRef.current = true
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const keyboard = trigger?.matches(':focus-visible') ?? false
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    const spatial = !keyboard && !reduced
    const duration = keyboard ? 0 : reduced ? 120 : 240
    motionRef.current = { spatial, duration }
    dialog.dataset.spatial = String(spatial)
    dialog.showModal()
    animationRef.current = panel.animate(
      [
        {
          opacity: spatial ? 0.5 : 0,
          transform: spatial ? 'translate3d(8%, 0, 0)' : 'none'
        },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' }
      ],
      { duration, easing: drawerEase, fill: 'both' }
    )
    const initialFocus = window.matchMedia('(pointer: coarse)').matches
      ? titleRef.current
      : searchRef.current
    initialFocus?.focus({ preventScroll: true })

    return () => {
      aliveRef.current = false
      animationRef.current?.cancel()
      if (dialog.open) dialog.close()
      if (trigger?.isConnected && !document.querySelector('dialog[open]')) {
        trigger.focus({ preventScroll: true })
      }
    }
  }, [])

  async function close(selectedBook?: LibraryBook, immediate = false) {
    if (closingRef.current) return
    closingRef.current = true
    const dialog = dialogRef.current
    const panel = panelRef.current
    if (dialog && panel) {
      const current = getComputedStyle(panel)
      const start = { opacity: current.opacity, transform: current.transform }
      animationRef.current?.cancel()
      dialog.dataset.closing = 'true'
      const { spatial: spatialEnabled, duration } = motionRef.current
      const spatial = spatialEnabled && !immediate
      const animation = panel.animate(
        [
          start,
          { opacity: 0, transform: spatial ? 'translate3d(8%, 0, 0)' : 'none' }
        ],
        {
          duration: immediate ? 0 : Math.min(duration, 200),
          easing: drawerEase,
          fill: 'both'
        }
      )
      animationRef.current = animation
      await animation.finished.catch(() => undefined)
      if (!aliveRef.current) return
      if (dialog.open) dialog.close()
    }
    onClose()
    if (selectedBook) onSelect(selectedBook)
  }

  function resetScroll() {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }

  return (
    <dialog
      ref={dialogRef}
      className='rr-library'
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        void close(undefined, true)
      }}
      onPointerDown={(event) => {
        backdropPointerRef.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && backdropPointerRef.current)
          void close()
      }}
    >
      <section ref={panelRef} className='rr-library__panel'>
        <header className='rr-library__header'>
          <div>
            <p className='rr-library__eyebrow'>
              The private library of Travis Fischer
            </p>
            <h2 ref={titleRef} id={titleId} tabIndex={-1}>
              A life in books.
            </h2>
            <p className='rr-library__introduction'>
              Old friends, new worlds, and a few that changed everything.
            </p>
          </div>
          <button
            type='button'
            className='rr-library__close'
            aria-label='Close library and return to the room'
            onClick={(event) => void close(undefined, event.detail === 0)}
          >
            <svg
              aria-hidden='true'
              width='22'
              height='22'
              viewBox='0 0 24 24'
              fill='none'
            >
              <path
                d='m6 6 12 12M18 6 6 18'
                stroke='currentColor'
                strokeWidth='1.3'
              />
            </svg>
          </button>
        </header>

        <div className='rr-library__controls'>
          <form
            role='search'
            className='rr-library__search'
            onSubmit={(event) => event.preventDefault()}
          >
            {searchIcon}
            <label className='rr-library__sr-only' htmlFor={searchId}>
              Search the collection by title or author
            </label>
            <input
              ref={searchRef}
              id={searchId}
              type='search'
              value={query}
              placeholder='Find a title or an author'
              autoComplete='off'
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.target.value)
                resetScroll()
              }}
            />
            {query ? (
              <button
                type='button'
                className='rr-library__clear'
                onClick={() => {
                  setQuery('')
                  resetScroll()
                  searchRef.current?.focus()
                }}
              >
                Clear
              </button>
            ) : null}
          </form>

          <div className='rr-library__arrangement'>
            <fieldset className='rr-library__filters'>
              <legend className='rr-library__sr-only'>
                Which books to show
              </legend>
              <label>
                <input
                  type='radio'
                  name={filterId}
                  value='all'
                  checked={!favoritesOnly}
                  onChange={() => {
                    setFavoritesOnly(false)
                    resetScroll()
                  }}
                />
                <span>
                  All books <small>{books.length}</small>
                </span>
              </label>
              <label>
                <input
                  type='radio'
                  name={filterId}
                  value='favorites'
                  checked={favoritesOnly}
                  onChange={() => {
                    setFavoritesOnly(true)
                    resetScroll()
                  }}
                />
                <span>
                  Five-star favorites <small>{favoritesCount}</small>
                </span>
              </label>
            </fieldset>
            <label className='rr-library__sort'>
              <span className='rr-library__sr-only'>Arrange books by</span>
              <select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as LibrarySort)
                  resetScroll()
                }}
              >
                <option value='title'>Title, A–Z</option>
                <option value='rating'>Highest rated</option>
                <option value='read'>Recently read</option>
              </select>
              <svg
                aria-hidden='true'
                width='12'
                height='12'
                viewBox='0 0 16 16'
                fill='none'
              >
                <path
                  d='m4 6 4 4 4-4'
                  stroke='currentColor'
                  strokeWidth='1.25'
                />
              </svg>
            </label>
          </div>
        </div>

        <div ref={scrollRef} className='rr-library__scroll'>
          <p className='rr-library__result-count' role='status'>
            {results.length} {results.length === 1 ? 'book' : 'books'}
            {deferredQuery.trim()
              ? ` matching “${deferredQuery.trim()}”`
              : ' to get lost in'}
          </p>
          {results.length ? (
            <ul className='rr-library__grid'>
              {results.map(({ book }) => {
                const coverUrl = book.cover.localPath ?? book.cover.remoteUrl
                return (
                  <li key={book.id}>
                    <button
                      type='button'
                      className='rr-library__book'
                      aria-label={`Open ${book.titleWithSeries} by ${book.authors.join(' and ')}`}
                      onClick={(event) => void close(book, event.detail === 0)}
                    >
                      <span className='rr-library__cover'>
                        {coverUrl ? (
                          <Image
                            src={coverUrl}
                            alt=''
                            fill
                            sizes='(max-width: 480px) 38vw, (max-width: 760px) 25vw, 150px'
                            loading='lazy'
                            unoptimized={!book.cover.localPath}
                          />
                        ) : (
                          <span className='rr-library__cover-fallback'>
                            {book.title}
                          </span>
                        )}
                      </span>
                      <span className='rr-library__book-title'>
                        {book.title}
                      </span>
                      <span className='rr-library__book-author'>
                        {book.authors.join(' & ')}
                      </span>
                      {book.personal.rating ? (
                        <span
                          className='rr-library__book-rating'
                          aria-label={`${book.personal.rating} out of 5 stars`}
                        >
                          <span aria-hidden='true'>
                            {'★'.repeat(book.personal.rating)}
                          </span>
                        </span>
                      ) : (
                        <span className='rr-library__book-unrated'>Read</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className='rr-library__empty'>
              <span className='rr-library__empty-mark' aria-hidden='true'>
                ❦
              </span>
              <h3>No books on this page.</h3>
              <p>
                Try another title or author, or wander back through the whole
                collection.
              </p>
              <button
                type='button'
                onClick={() => {
                  setQuery('')
                  setFavoritesOnly(false)
                  searchRef.current?.focus()
                }}
              >
                Show all books <span aria-hidden='true'>↗</span>
              </button>
            </div>
          )}
          <footer className='rr-library__footer'>
            <span>Personally read. Kept close.</span>
            <span>{books.length} volumes &nbsp;·&nbsp; One reading life</span>
          </footer>
        </div>
      </section>
    </dialog>
  )
}
