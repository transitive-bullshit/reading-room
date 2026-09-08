'use client'

import Image from 'next/image'
import { useRef, useState } from 'react'

import type { LibraryBook } from '@/lib/library-schema'

export function BookCover({ book }: { book: LibraryBook }) {
  const [originalReady, setOriginalReady] = useState(false)
  const [textureFailed, setTextureFailed] = useState(false)
  const originalRef = useRef<HTMLImageElement>(null)
  const coverUrl = book.cover.localPath ?? book.cover.remoteUrl

  async function revealOriginal(image: HTMLImageElement) {
    const source = image.currentSrc || image.src
    try {
      await image.decode()
    } catch {
      return
    }
    // A late decode must not reveal a different book or a replaced source.
    if (
      originalRef.current === image &&
      image.isConnected &&
      (image.currentSrc || image.src) === source &&
      image.naturalWidth > 0
    ) {
      setOriginalReady(true)
    }
  }

  return (
    <div className='rr-open-book__cover-art'>
      <span className='rr-open-book__cover-fallback' aria-hidden='true'>
        {book.title}
      </span>
      {!textureFailed && (
        <img
          className='rr-open-book__cover-texture'
          src={`/covers/textures/${book.id}.jpg`}
          alt=''
          aria-hidden='true'
          loading='eager'
          decoding='sync'
          draggable={false}
          onError={() => setTextureFailed(true)}
        />
      )}
      {coverUrl && (
        <Image
          ref={originalRef}
          src={coverUrl}
          alt={`Cover of ${book.title}`}
          fill
          sizes='(max-width: 660px) 100px, (max-width: 1050px) 28vw, 320px'
          className='rr-open-book__cover-image'
          style={{ opacity: originalReady ? 1 : 0 }}
          loading='eager'
          unoptimized={!book.cover.localPath}
          onLoad={(event) => void revealOriginal(event.currentTarget)}
          onError={() => setOriginalReady(false)}
        />
      )}
    </div>
  )
}
