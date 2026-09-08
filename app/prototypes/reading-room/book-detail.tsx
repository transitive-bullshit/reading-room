'use client'

import Image from 'next/image'
import { useId, useLayoutEffect, useRef, type CSSProperties } from 'react'

import type { LibraryBook, LibraryDate } from '@/lib/library-schema'
import coverAspects from '@/data/cover-aspects.json'

import './book-detail.css'

interface BookOrigin {
  x: number
  y: number
  width: number
  height: number
}

interface BookDetailProps {
  book: LibraryBook | null
  onClose: () => void
  origin?: BookOrigin
  pickupComplete?: boolean
}

const easeOut = 'cubic-bezier(0.23, 1, 0.32, 1)'
const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

function displayDate(date: LibraryDate | null): string | null {
  if (!date) return null
  const [year, month, day] = date.value.split('-')
  if (date.precision === 'year') return year ?? date.sourceText
  const monthName = months[Number(month) - 1]
  if (!monthName) return date.sourceText
  return date.precision === 'month'
    ? `${monthName} ${year}`
    : `${monthName} ${Number(day)}, ${year}`
}

function originTransform(
  origin: BookOrigin | undefined,
  rect: DOMRect
): string {
  if (!origin || origin.width <= 0 || origin.height <= 0) {
    return 'translate3d(0, 26px, 0) rotateX(9deg) rotateZ(-3deg) scale(0.96)'
  }
  const x = origin.x + origin.width / 2 - (rect.x + rect.width / 2)
  const y = origin.y + origin.height / 2 - (rect.y + rect.height / 2)
  // This scale is measured from a real book already in the room, rather than
  // an element appearing from zero. Keep its cover proportions intact.
  const scale = Math.min(origin.width / rect.width, origin.height / rect.height)
  return `translate3d(${x}px, ${y}px, 0) rotateX(8deg) scale(${Math.max(0.12, scale)})`
}

const arrow = (
  <svg
    aria-hidden='true'
    width='15'
    height='15'
    viewBox='0 0 24 24'
    fill='none'
  >
    <path d='M6 18 18 6M6 6h12v12' stroke='currentColor' strokeWidth='1.4' />
  </svg>
)

export function BookDetail({
  book,
  onClose,
  origin,
  pickupComplete = false
}: BookDetailProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const coverRef = useRef<HTMLDivElement>(null)
  const pickupTextureRef = useRef<HTMLImageElement>(null)
  const pageRef = useRef<HTMLElement>(null)
  const bindingRef = useRef<HTMLDivElement>(null)
  const bookplateRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const animationsRef = useRef<Animation[]>([])
  const closingRef = useRef(false)
  const backdropPointerRef = useRef(false)
  const generationRef = useRef(0)
  const motionRef = useRef({ spatial: true, duration: 280 })
  const returnTransformRef = useRef('none')
  const bookId = book?.id
  const originX = origin?.x
  const originY = origin?.y
  const originWidth = origin?.width
  const originHeight = origin?.height

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    const cover = coverRef.current
    const page = pageRef.current
    const binding = bindingRef.current
    const bookplate = bookplateRef.current
    if (!bookId || !dialog || !cover || !page || !binding || !bookplate) return

    const generation = generationRef.current + 1
    generationRef.current = generation
    closingRef.current = false
    delete dialog.dataset.closing
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    const spatial = !reduced
    const duration = reduced ? 120 : originWidth && !pickupComplete ? 760 : 280
    motionRef.current = { spatial, duration }
    dialog.dataset.spatial = String(spatial)
    dialog.showModal()

    const measuredOrigin =
      originX !== undefined &&
      originY !== undefined &&
      originWidth !== undefined &&
      originHeight !== undefined
        ? { x: originX, y: originY, width: originWidth, height: originHeight }
        : undefined
    const rect = cover.getBoundingClientRect()
    const tablePickup = spatial && measuredOrigin && !pickupComplete
    const deltaX = measuredOrigin
      ? measuredOrigin.x + measuredOrigin.width / 2 - (rect.x + rect.width / 2)
      : 0
    const deltaY = measuredOrigin
      ? measuredOrigin.y +
        measuredOrigin.height / 2 -
        (rect.y + rect.height / 2)
      : 0
    const scale = measuredOrigin
      ? Math.max(0.12, measuredOrigin.width / rect.width)
      : 1
    const ratio = measuredOrigin
      ? measuredOrigin.height /
        measuredOrigin.width /
        (rect.height / rect.width)
      : 1
    const tilt = Math.min(
      64,
      Math.max(22, (Math.acos(Math.min(1, ratio)) * 180) / Math.PI)
    )
    const slot = trigger?.closest('.table-book-slot')
    const angle = slot
      ? parseFloat(getComputedStyle(slot).getPropertyValue('--book-angle')) || 0
      : -6
    const from = tablePickup
      ? `translate3d(${deltaX}px, ${deltaY}px, 0) rotateZ(${angle}deg) rotateX(${tilt}deg) rotateY(-6deg) scale(${scale})`
      : spatial
        ? originTransform(measuredOrigin, rect)
        : 'none'
    returnTransformRef.current = from
    const animate = (
      element: HTMLElement,
      frames: Keyframe[],
      delay = 0,
      easing = easeOut
    ) => {
      const animation = element.animate(frames, {
        duration: Math.max(0, duration - delay),
        delay,
        easing,
        fill: 'both'
      })
      animationsRef.current.push(animation)
    }

    if (tablePickup) {
      animate(
        cover,
        [
          { offset: 0, opacity: 1, transform: from },
          {
            offset: 0.28,
            opacity: 1,
            transform: `translate3d(${deltaX * 0.8}px, ${deltaY * 0.8 - 62}px, 95px) rotateZ(${angle * 0.65}deg) rotateX(${tilt * 0.62}deg) rotateY(-27deg) scale(${scale + (1 - scale) * 0.24})`
          },
          {
            offset: 0.72,
            opacity: 1,
            transform:
              'translate3d(-4px, -9px, 45px) rotateZ(-2deg) rotateX(6deg) rotateY(-12deg) scale(0.99)'
          },
          {
            offset: 1,
            opacity: 1,
            transform:
              'translate3d(0, 0, 0) rotateZ(0) rotateX(0) rotateY(0) scale(1)'
          }
        ],
        0,
        'cubic-bezier(0.22, 0.68, 0.18, 1)'
      )
    } else {
      animate(cover, [
        { opacity: spatial && measuredOrigin ? 1 : 0, transform: from },
        { opacity: 1, transform: 'translate3d(0, 0, 0) rotateX(0) scale(1)' }
      ])
    }
    animate(
      page,
      [
        {
          opacity: 0,
          transform: spatial
            ? `perspective(1400px) rotateY(${tablePickup ? -64 : -18}deg)`
            : 'none'
        },
        { opacity: 1, transform: 'perspective(1400px) rotateY(0)' }
      ],
      tablePickup ? 360 : 0
    )
    for (const element of [binding, bookplate]) {
      animate(
        element,
        [{ opacity: 0 }, { opacity: 1 }],
        tablePickup ? 390 : spatial ? 40 : 0
      )
    }
    if (pickupTextureRef.current) {
      animate(
        pickupTextureRef.current,
        [{ opacity: 1 }, { opacity: 0 }],
        tablePickup ? 570 : spatial ? 120 : 0
      )
    }
    titleRef.current?.focus({ preventScroll: true })

    return () => {
      generationRef.current = generation + 1
      for (const animation of animationsRef.current) animation.cancel()
      animationsRef.current = []
      if (dialog.open) dialog.close()
      // Native dialogs normally restore focus themselves. This also covers a
      // parent unmounting the component while an opening animation is active.
      if (!document.querySelector('dialog[open]')) {
        const visible = (element: HTMLElement | null) =>
          Boolean(
            element?.isConnected &&
            element.getClientRects().length &&
            getComputedStyle(element).visibility !== 'hidden'
          )
        const label = trigger?.getAttribute('aria-label')
        const replacement = label
          ? Array.from(
              document.querySelectorAll<HTMLElement>(
                '.table-book, .physics-accessible-books button'
              )
            ).find(
              (element) =>
                element.getAttribute('aria-label') === label && visible(element)
            )
          : null
        const destination = visible(trigger)
          ? trigger
          : (replacement ??
            document.querySelector<HTMLElement>('.room-library-button'))
        destination?.focus({ preventScroll: true })
      }
    }
  }, [bookId, originX, originY, originWidth, originHeight, pickupComplete])

  async function close(immediate = false) {
    if (closingRef.current) return
    closingRef.current = true
    const dialog = dialogRef.current
    if (!dialog) return onClose()
    const generation = generationRef.current
    const { spatial: spatialEnabled, duration: entryDuration } =
      motionRef.current
    const spatial = spatialEnabled && !immediate
    const duration = immediate ? 0 : Math.min(entryDuration, 220)
    const elements = [
      coverRef.current,
      pageRef.current,
      bindingRef.current,
      bookplateRef.current
    ]
    // Snapshot before cancelling an interrupted entrance so an immediate
    // dismissal continues from what is currently visible, without a jump.
    const visible = elements.map((element) => {
      const style = element ? getComputedStyle(element) : null
      return {
        opacity: style?.opacity ?? '1',
        transform: style?.transform ?? 'none'
      }
    })
    for (const animation of animationsRef.current) animation.cancel()
    dialog.dataset.closing = 'true'
    const animations = elements.flatMap((element, index) => {
      if (!element) return []
      const transform = !spatial
        ? 'none'
        : index === 0
          ? returnTransformRef.current
          : index === 1
            ? 'perspective(1400px) rotateY(-18deg)'
            : 'none'
      return [
        element.animate(
          [visible[index] ?? { opacity: '1' }, { opacity: 0, transform }],
          {
            duration,
            easing: easeOut,
            fill: 'both'
          }
        )
      ]
    })
    animationsRef.current = animations
    await Promise.all(
      animations.map((animation) => animation.finished.catch(() => undefined))
    )
    if (generation !== generationRef.current) return
    if (dialog.open) dialog.close()
    onClose()
  }

  if (!book) return null
  const coverUrl = book.cover.localPath ?? book.cover.remoteUrl
  const aspect = (coverAspects as Record<string, number>)[book.id] ?? 2 / 3
  const mostRecentRead = book.personal.datesRead.reduce<LibraryDate | null>(
    (latest, date) => (!latest || date.value > latest.value ? date : latest),
    null
  )
  const readDate = displayDate(mostRecentRead)
  const publishedDate = displayDate(
    book.firstPublished ?? book.editionPublished
  )
  const paragraphs =
    book.description?.split(/\n+/).filter((paragraph) => paragraph.trim()) ?? []

  return (
    <dialog
      ref={dialogRef}
      className='rr-book-detail'
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        void close(true)
      }}
      onPointerDown={(event) => {
        backdropPointerRef.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && backdropPointerRef.current)
          void close()
      }}
    >
      <div className='rr-book-detail__stage'>
        <button
          type='button'
          className='rr-book-detail__close'
          onClick={(event) => void close(event.detail === 0)}
          aria-label='Close book and return to the room'
        >
          <span>Put it back</span>
          <svg
            aria-hidden='true'
            width='19'
            height='19'
            viewBox='0 0 24 24'
            fill='none'
          >
            <path
              d='m6 6 12 12M18 6 6 18'
              stroke='currentColor'
              strokeWidth='1.35'
            />
          </svg>
        </button>

        <article className='rr-open-book'>
          <div
            ref={bindingRef}
            className='rr-open-book__binding'
            aria-hidden='true'
          />

          <div className='rr-open-book__cover-panel'>
            <div
              ref={coverRef}
              className='rr-open-book__physical-cover'
              style={
                {
                  '--cover-aspect': aspect,
                  '--pickup-depth': `${Math.min(30, 13 + (book.pageCount ?? 300) / 60)}px`
                } as CSSProperties
              }
            >
              <span
                className='rr-open-book__page-edge rr-open-book__page-edge--right'
                aria-hidden='true'
              />
              <span
                className='rr-open-book__page-edge rr-open-book__page-edge--bottom'
                aria-hidden='true'
              />
              <span className='rr-open-book__back-board' aria-hidden='true' />
              {coverUrl ? (
                <Image
                  src={coverUrl}
                  alt={`Cover of ${book.title}`}
                  fill
                  sizes='(max-width: 660px) 100px, (max-width: 1050px) 28vw, 320px'
                  className='rr-open-book__cover-image'
                  loading='eager'
                  unoptimized={!book.cover.localPath}
                />
              ) : (
                <span className='rr-open-book__cover-fallback'>
                  {book.title}
                </span>
              )}
              {origin && (
                <img
                  ref={pickupTextureRef}
                  className='rr-open-book__pickup-texture'
                  src={`/covers/textures/${book.id}.jpg`}
                  alt=''
                  draggable={false}
                />
              )}
            </div>
            <div ref={bookplateRef} className='rr-open-book__bookplate'>
              <span className='rr-open-book__bookplate-mark' aria-hidden='true'>
                T<span>·</span>F
              </span>
              <span>Ex libris</span>
              <p>Travis Fischer</p>
            </div>
          </div>

          <section
            ref={pageRef}
            className='rr-open-book__page'
            aria-label='About this book'
          >
            <div className='rr-open-book__reading'>
              <p className='rr-open-book__eyebrow'>
                {book.personal.rating === 5
                  ? 'A five-star favorite'
                  : 'From my reading life'}
              </p>
              <h2
                ref={titleRef}
                id={titleId}
                tabIndex={-1}
                className='rr-open-book__title'
              >
                {book.title}
              </h2>
              <p className='rr-open-book__author'>{book.authors.join(' & ')}</p>

              <div className='rr-open-book__personal-rating'>
                {book.personal.rating ? (
                  <span
                    className='rr-open-book__stars'
                    aria-label={`My rating: ${book.personal.rating} out of 5 stars`}
                  >
                    <span aria-hidden='true'>
                      {'★'.repeat(book.personal.rating)}
                    </span>
                    <span
                      aria-hidden='true'
                      className='rr-open-book__stars-empty'
                    >
                      {'☆'.repeat(5 - book.personal.rating)}
                    </span>
                  </span>
                ) : (
                  <span className='rr-open-book__unrated'>
                    Read, and remembered
                  </span>
                )}
                {book.personal.rating ? (
                  <span className='rr-open-book__rating-label'>My rating</span>
                ) : null}
              </div>

              <dl className='rr-open-book__facts'>
                <div>
                  <dt>
                    {book.personal.datesRead.length > 1 ? 'Last read' : 'Read'}
                  </dt>
                  <dd>{readDate ?? 'Date not recorded'}</dd>
                </div>
                {publishedDate ? (
                  <div>
                    <dt>
                      {book.firstPublished ? 'First published' : 'This edition'}
                    </dt>
                    <dd>{publishedDate}</dd>
                  </div>
                ) : null}
                {book.pageCount ? (
                  <div>
                    <dt>Length</dt>
                    <dd>{book.pageCount.toLocaleString('en-US')} pages</dd>
                  </div>
                ) : null}
              </dl>

              <div className='rr-open-book__synopsis'>
                <p className='rr-open-book__section-label'>
                  Between these pages
                </p>
                {paragraphs.length ? (
                  paragraphs.map((paragraph, index) => (
                    <p key={`${book.id}-${index}`}>{paragraph}</p>
                  ))
                ) : (
                  <p>
                    A place on my table, with more about this book waiting on
                    Goodreads.
                  </p>
                )}
              </div>

              {book.genres.length ? (
                <p className='rr-open-book__genres'>
                  {book.genres.slice(0, 3).join(' · ')}
                </p>
              ) : null}
              {book.publisher || book.format ? (
                <p className='rr-open-book__edition'>
                  {[book.publisher, book.format].filter(Boolean).join(' · ')}
                </p>
              ) : null}
            </div>

            <footer className='rr-open-book__links'>
              <a href={book.goodreadsUrl} target='_blank' rel='noreferrer'>
                On Goodreads {arrow}
              </a>
              <a href={book.amazonUrl} target='_blank' rel='noreferrer'>
                View on Amazon {arrow}
              </a>
            </footer>
          </section>
        </article>

        <span className='rr-book-detail__escape' aria-hidden='true'>
          A moment with a good book. <kbd>esc</kbd> to return.
        </span>
      </div>
    </dialog>
  )
}
