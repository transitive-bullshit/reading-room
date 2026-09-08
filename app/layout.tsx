import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'

import './globals.css'

const description = 'A cozy home for your favorite books'
const siteUrl =
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://book-library.localhost:1355')

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Reading Room',
  description,
  applicationName: 'Reading Room',
  authors: [{ name: 'Travis Fischer', url: 'https://x.com/transitive_bs' }],
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Reading Room',
    description,
    url: '/',
    siteName: 'Reading Room',
    locale: 'en_US',
    type: 'website'
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Reading Room',
    description,
    creator: '@transitive_bs',
    site: '@transitive_bs'
  }
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en'>
      <body>
        {children}

        <Analytics />
      </body>
    </html>
  )
}
