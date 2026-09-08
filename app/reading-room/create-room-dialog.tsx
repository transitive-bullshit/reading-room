'use client'

import { useId, useLayoutEffect, useRef } from 'react'

import './create-room-dialog.css'

interface CreateRoomDialogProps {
  onClose: () => void
  launchTweetUrl?: string
}

export function CreateRoomDialog({
  onClose,
  launchTweetUrl
}: CreateRoomDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const availabilityId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const backdropPointerRef = useRef(false)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const keyboard = trigger?.matches(':focus-visible') ?? false
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches

    dialog.showModal()
    titleRef.current?.focus({ preventScroll: true })
    const animation = keyboard
      ? undefined
      : panelRef.current?.animate(
          [
            { opacity: 0, transform: reduced ? 'none' : 'scale(0.98)' },
            { opacity: 1, transform: 'none' }
          ],
          {
            duration: reduced ? 120 : 180,
            easing: 'cubic-bezier(0.23, 1, 0.32, 1)'
          }
        )

    return () => {
      animation?.cancel()
      if (dialog.open) dialog.close()
      if (trigger?.isConnected && !document.querySelector('dialog[open]')) {
        trigger.focus({ preventScroll: true })
      }
    }
  }, [])

  const replyLabel = (
    <>
      Reply on X
      <svg
        aria-hidden='true'
        width='16'
        height='16'
        viewBox='0 0 24 24'
        fill='none'
      >
        <path
          d='M6 18 18 6M6 6h12v12'
          stroke='currentColor'
          strokeWidth='1.5'
        />
      </svg>
    </>
  )

  return (
    <dialog
      ref={dialogRef}
      className='rr-create-room'
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}
      onPointerDown={(event) => {
        backdropPointerRef.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (
          event.target === event.currentTarget &&
          backdropPointerRef.current
        ) {
          onClose()
        }
      }}
    >
      <div ref={panelRef} className='rr-create-room__panel'>
        <header className='rr-create-room__header'>
          <h2 ref={titleRef} id={titleId} tabIndex={-1}>
            Create your own Reading Room
          </h2>
          <button
            type='button'
            className='rr-create-room__close'
            aria-label='Close and return to the room'
            onClick={onClose}
          >
            <svg
              aria-hidden='true'
              width='20'
              height='20'
              viewBox='0 0 24 24'
              fill='none'
            >
              <path
                d='m6 6 12 12M18 6 6 18'
                stroke='currentColor'
                strokeWidth='1.4'
              />
            </svg>
          </button>
        </header>

        <div id={descriptionId} className='rr-create-room__description'>
          <p>
            This is a small personal experiment based on my Goodreads data,
            built in part to test OpenAI's new{' '}
            <a
              href='https://openai.com/index/gpt-6-astra/'
              rel='noopener noreferrer'
              target='_blank'
              className='link'
            >
              GPT-6 Astra
            </a>
            .
          </p>
          <p>
            I wanted to gauge interest by sharing the project first before
            spending too much time on making it general for other people to use.
          </p>
          <p>
            If you’d like a personalized reading room for your own books, let me
            know in the launch thread on X by replying with a link to your
            public Goodreads profile, and I'll get back to you shortly.
          </p>
          <p>Thank you, and happy reading!</p>
        </div>

        <footer className='rr-create-room__footer'>
          {launchTweetUrl ? (
            <a
              className='rr-create-room__reply'
              href={launchTweetUrl}
              target='_blank'
              rel='noreferrer'
            >
              {replyLabel}
            </a>
          ) : (
            <>
              <button
                type='button'
                className='rr-create-room__reply'
                disabled
                aria-describedby={availabilityId}
              >
                {replyLabel}
              </button>
              <p id={availabilityId} className='rr-create-room__availability'>
                Launch thread coming soon.
              </p>
            </>
          )}
        </footer>
      </div>
    </dialog>
  )
}
