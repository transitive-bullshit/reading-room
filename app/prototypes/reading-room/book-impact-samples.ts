// User-selected takes; source timestamps and processing live in
// public/audio/book-impacts/source.json. See docs/audio.md for playback decisions.
// Desk landings use the prominent recordings; book contacts use the quiet takes.
export const BOOK_IMPACT_SAMPLES = {
  table: [
    '004',
    '014',
    '017',
    '018',
    '025',
    '029',
    '030',
    '031',
    '032',
    '033',
    '036',
    '039',
    '040',
    '041',
    '047',
    '050',
    '056',
    '065',
    '066'
  ].map((id) => `/audio/book-impacts/book-${id}.wav`),
  book: ['015', '037', '080'].map((id) => `/audio/book-impacts/book-${id}.wav`)
} as const
