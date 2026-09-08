import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface SourceBook {
  id: string
  status?: string
  coverUrl?: string | null
}

interface CoverSource {
  id: string
  sourceUrl: string
  source: 'book-page' | 'shelf'
}

interface CoverRecord extends CoverSource {
  localPath: string
  contentType: string
  bytes: number
  fetchedAt: string
}

const root = fileURLToPath(new URL('../', import.meta.url))
const destination = resolve(root, 'public/covers/originals')
const manifestPath = resolve(root, 'data/goodreads-cover-manifest.json')

async function readOptional<T>(path: string): Promise<T | null> {
  return existsSync(path)
    ? (JSON.parse(await readFile(path, 'utf8')) as T)
    : null
}

async function main() {
  const sources = new Map<string, CoverSource>()
  for (const filename of [
    'data/goodreads-shelf-raw.json',
    'data/goodreads-enrichment.json',
    'data/goodreads-browser-enrichment.json'
  ]) {
    const data = await readOptional<{ books: SourceBook[] }>(
      resolve(root, filename)
    )
    for (const book of data?.books ?? []) {
      if (!book.coverUrl || (book.status && book.status !== 'ok')) continue
      const url = new URL(book.coverUrl)
      assert(url.protocol === 'https:', `Cover URL must use HTTPS: ${book.id}`)
      assert(
        [
          'i.gr-assets.com',
          'm.media-amazon.com',
          'images.gr-assets.com'
        ].includes(url.hostname),
        `Unrecognized Goodreads cover host: ${url.hostname}`
      )
      assert(
        /^\d+$/.test(book.id),
        'A numeric Goodreads ID is required for cover filenames'
      )
      sources.set(book.id, {
        id: book.id,
        sourceUrl: book.coverUrl,
        source: filename.endsWith('shelf-raw.json') ? 'shelf' : 'book-page'
      })
    }
  }
  assert(sources.size > 0, 'No observed Goodreads cover URLs found')
  const previous = await readOptional<{ covers: CoverRecord[] }>(manifestPath)
  const records = new Map(
    (previous?.covers ?? []).map((record) => [record.id, record])
  )
  const pending = [...sources.values()].filter((source) => {
    const record = records.get(source.id)
    return (
      record?.sourceUrl !== source.sourceUrl ||
      !record.localPath ||
      !existsSync(resolve(root, 'public', `.${record.localPath}`))
    )
  })
  await mkdir(destination, { recursive: true })
  const errors: Array<{ id: string; sourceUrl: string; error: string }> = []
  let index = 0
  let stopped = false
  let consecutiveFailures = 0
  let checkpoint = Promise.resolve()

  function save() {
    checkpoint = checkpoint.then(async () => {
      const value = {
        source:
          'Observed cover URLs from exact Goodreads shelf and book edition pages',
        updatedAt: new Date().toISOString(),
        summary: {
          requested: sources.size,
          downloaded: records.size,
          fullSize: [...records.values()].filter(
            (record) => record.source === 'book-page'
          ).length,
          thumbnailFallbacks: [...records.values()].filter(
            (record) => record.source === 'shelf'
          ).length,
          errors: errors.length,
          stopped
        },
        covers: [...sources.keys()].flatMap((id) => {
          const record = records.get(id)
          return record ? [record] : []
        }),
        errors
      }
      const temporaryPath = `${manifestPath}.tmp`
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`)
      await rename(temporaryPath, manifestPath)
    })
    return checkpoint
  }

  async function worker() {
    while (!stopped && index < pending.length) {
      const source = pending[index++]
      assert(source)
      try {
        const response = await fetch(source.sourceUrl, {
          signal: AbortSignal.timeout(30_000)
        })
        if ([202, 403, 429].includes(response.status)) stopped = true
        assert(
          response.ok && response.status !== 202,
          `HTTP ${response.status}`
        )
        const bytes = Buffer.from(await response.arrayBuffer())
        assert(bytes.length > 100, 'Empty or incomplete cover image')
        // Some Goodreads .jpg URLs return PNG bytes with an image/jpeg header.
        // Use the actual encoding so local filenames and metadata stay honest.
        const encoding =
          bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
            ? { extension: 'jpg', contentType: 'image/jpeg' }
            : bytes
                  .subarray(0, 8)
                  .equals(Buffer.from('89504e470d0a1a0a', 'hex'))
              ? { extension: 'png', contentType: 'image/png' }
              : bytes.toString('ascii', 0, 4) === 'RIFF' &&
                  bytes.toString('ascii', 8, 12) === 'WEBP'
                ? { extension: 'webp', contentType: 'image/webp' }
                : null
        assert(encoding, 'Expected a JPEG, PNG, or WebP cover image')
        const localPath = `/covers/originals/${source.id}.${encoding.extension}`
        const path = resolve(destination, `${source.id}.${encoding.extension}`)
        await writeFile(`${path}.tmp`, bytes)
        await rename(`${path}.tmp`, path)
        records.set(source.id, {
          ...source,
          localPath,
          contentType: encoding.contentType,
          bytes: bytes.length,
          fetchedAt: new Date().toISOString()
        })
        consecutiveFailures = 0
        console.log(
          `Saved ${source.id} (${source.source}, ${bytes.length} bytes)`
        )
      } catch (err) {
        errors.push({
          id: source.id,
          sourceUrl: source.sourceUrl,
          error: String(err)
        })
        consecutiveFailures++
        if (consecutiveFailures >= 3) stopped = true
        console.error(`Cover ${source.id}: ${String(err)}`)
      }
      if ((records.size + errors.length) % 10 === 0) await save()
    }
  }

  await Promise.all([worker(), worker(), worker()])
  await save()
  console.log(
    JSON.stringify({
      requested: sources.size,
      downloaded: records.size,
      errors: errors.length,
      stopped
    })
  )
  if (stopped || errors.length) process.exitCode = 1
}

await main()
