# Goodreads library data

This collection comes from [Travis Fischer's Goodreads read shelf](https://www.goodreads.com/review/list/178989836-travis-fischer?shelf=read). Goodreads edition IDs are the stable keys throughout the import; editions are never silently replaced with similarly titled books.

The September 8, 2026 snapshot contains **192 read books**, including **86 five-star ratings**. Every book has a description and a locally saved cover from its exact edition page. Personal read dates are available for 156 books; the other 36 remain unknown. There are 23 unrated books. Earlier HTTP retrieval errors in the source file were resolved by the browser enrichment; `library.json` contains the combined result.

| File | Contents |
| --- | --- |
| `goodreads-shelf-raw.json` | Original shelf records, including personal ratings, reading dates, edition identifiers, and the cover thumbnails shown on the shelf. |
| `goodreads-enrichment.json` | Bibliographic fields from public pages for the exact Goodreads editions, with a per-record retrieval status. |
| `goodreads-browser-enrichment.json` | Additional bibliographic fields read from rendered Goodreads book pages in the authenticated browser. |
| `goodreads-cover-manifest.json` | Observed image URL, local path, source quality, byte count, and download time for each cover. |
| `library.json` | Normalized collection for the future application, described by `lib/library-schema.ts`. |

The original exports remain separate from the normalized collection. Enrichment contains book metadata only; it does not include browser cookies, authentication tokens, page configuration, or other readers' reviews.

## Rebuild the collection

From the repository root:

```sh
pnpm exec tsx scripts/download-goodreads-covers.ts
pnpm exec tsx scripts/import-goodreads.ts
```

The downloader uses at most three simultaneous requests and saves covers in `public/covers/originals/`, named by Goodreads ID. It detects JPEG, PNG, or WebP signatures and uses the corresponding extension, checkpoints a manifest, skips unchanged downloads, and upgrades an existing thumbnail when a newly collected book page provides a full cover URL. It stops on server restrictions or repeated failures. The manifest identifies any remaining thumbnail fallbacks. The current local collection contains 192 JPEGs.

The importer merges the shelf, public-page enrichment, and browser enrichment in that order. Missing fields and empty arrays do not erase metadata already obtained. It checks unique edition IDs, ratings, dates, and referenced local cover files before writing `library.json`.

These scripts work from the collected exports. They do not log into Goodreads or refresh the read shelf itself.

## Meaning of the normalized fields

- Dates retain the precision Goodreads actually displayed: `2010` has year precision, `Jan 2024` becomes `2024-01` with month precision, and `Sep 05, 2025` becomes `2025-09-05` with day precision. Unknown dates are `null`.
- Repeated reading dates remain ordered lists. Missing start dates remain explicit `null` entries; the importer does not infer which start and finish belong to the same reading session.
- A Goodreads rating of zero means unrated and becomes `null`. Missing reviews and the "Write a review" interface label also become `null`.
- Edition publication and first publication are separate. Shelf labels take precedence so a year or month is not replaced with an apparently exact date from an underlying timestamp.
- Descriptions are source text converted to plain text. A missing description stays `null`.
- Amazon links use observed product identifiers when available, with tracking parameters removed. Otherwise they open a title-and-author search; availability and prices are not inferred.
- Per-book provenance records the shelf and metadata sources and retrieval times. A local cover is used only when its file exists.

The application code's license does not change the ownership of book cover artwork or publisher descriptions. Their source URLs remain in the collection and image manifest.
