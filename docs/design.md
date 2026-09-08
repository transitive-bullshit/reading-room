# Reading Room design

The reading table makes book discovery physical: readers move through a heap, uncover a title, and open a clear reading surface. The After Hours photograph, warm light, matte books, and restrained controls establish the room's character.

Read [physics.md](physics.md) when changing movement or scene registration, [audio.md](audio.md) for sound behavior, and [assets.md](assets.md) for sources and retained files. Runtime code remains under `app/reading-room/`.

## Collection and reading surfaces

The landing page at `/` presents one table of 42 featured books. Membership and display order are explicitly curated in [featured-book-ids.json](../data/featured-book-ids.json) and resolved by [getFeaturedBooks](../lib/featured-books.ts), independently of personal ratings. Heaven’s River, all 13 Saga of Tanya the Evil volumes, all 10 The Beginning After the End volumes, all eight Tanya Huff books, and Fourth Wing are excluded from this featured selection. The featured table also keeps only the first Mistborn, Bobiverse, and Hyperion books, and one edition of Old Man’s War. Frankenstein’s display title is shortened to “Frankenstein.” All 192 imported records remain in the library data. Distinct featured editions remain distinct books.

The header uses the parchment [Reading Room logo](../public/brand/logo.svg). Clicking the logo enters once preparation finishes; after entry, it replays the book drop with the current grouping, just like Replay. The main heading is “A cozy home for your favorite books.” Keep the room free of redundant collection labels, stars, and instructions. The previous scene variants and picker have been retired.

The complete 192-book import remains in the data, independent of the homepage curation. The ivory detail view is the full reading surface: preserve complete descriptions, source date precision, and edition-specific Goodreads and Amazon links. The Amazon action reads “View on Amazon.” Original covers remain available to these views.

Physical books use the original cover proportions, page-count-based thickness and mass, separate cover boards and page blocks, binding, and contact shadows. Their desk textures use restrained paper grain, wear, and warm/cool illumination. Both covers show the artwork; the back is inverted and mirrored so a face-down book remains identifiable.

## Grouping

After entry, the table offers Free pile, Genre, Author, and Published. Every arrangement retains every book exactly once. Organized modes create at most six labeled groups, using two adjacent stacks for sections of five or more books and one stack for smaller sections.

Each organized pile label is a button. Choosing it moves the other books beyond the table and spreads that group's covers into fitted rows. The largest current group has 12 books; apply a shared size adjustment when needed to expose every cover with space between books. A breadcrumb names the current category. Grouping sits at the bottom center on desktop, with the breadcrumb above it; on mobile both remain below the heading. Its “All genres,” “All authors,” or “All years” button brings the complete collection back into the same grouping. The book count beneath the main heading reflects the visible group. It hides together with the heading whenever a hovered or focused book name takes their place. Replay sits immediately to the right of the sorting controls.

Changing grouping or replaying clears the category selection. Replay keeps the grouping mode. Full book details remain available for every featured book. Keyboard users can choose pile labels, reach the breadcrumb, and pick up only the books currently on the table. Escape goes back one level: close an open book detail or Create your own dialog, then return from a category to all groups. An open dialog takes priority over category navigation.

- Genre keeps Fantasy and Science fiction separate and favors specific classifications over broad shelves and format labels. Specific fantasy shelves beat broad Science Fiction tags. Five curated overrides place Children of Time, Death’s End, Dragon’s Egg, Rama II, and We Are Legion in Science fiction, distinguishing their science-focused stories from Space opera. The Red Rising saga, including Iron Gold, belongs to Fantasy in this room; its imported shelves remain unchanged. Small categories may share a clearly named group.
- Author uses the primary author contributor, excluding translators and narrators. Matching author URLs establish name aliases. Balanced ranges keep each author's books together.
- Published prefers first publication and falls back to the edition date. Preserve the original year, month, or day precision. Balance complete years into ranges; older ranges occupy the left column pair, then the middle and right pairs.

Free pile returns to the initial naturally settled heap, including its leaning books and varied headings. It uses a shallow rearrangement. Entry and Replay provide the visible drop from above the frame. Replay preserves the selected grouping.

## Entry, interaction, and atmosphere

The initial view is the empty room with one “Enter the library” button centered vertically. It adapts BE UI’s expanding-arrow component: an ink-colored button whose parchment tile expands into a dotted arrow trail on hover or focus, with reduced-motion support. It stays disabled until image decoding, texture upload, material and draw preparation, and silent audio preparation finish. The click resumes audio inside the user gesture before the initial drop begins. Grouping, breadcrumbs, table count, Replay, and the header’s Create your own action remain hidden until entry. Ambient playback and contact sounds cannot start before that action. If audio is unavailable, entry remains possible; scene failure offers a retry.

Dragging should feel responsive and weighted. A held book turns toward the reader while remaining able to collide and deflect. Released books keep the orientation produced by contact. Clicking a buried book scatters the covering books, extracts the selection, and aligns its cover with the camera before opening the detail view.

A warm tabletop pool follows the hovered, focused, or held book. A faint warm gray glow hugs an active book's physical edges and follows its tilt. The table artwork suppresses browser text selection and image dragging; the detail view preserves ordinary HTML reading and focus behavior.

Window rain is confined to eleven glass panes, leaving the mullions, frame, sill, and lamp clear. Its geometry follows the photograph's centered cover fit and scene scaling. Rain has a separate visual toggle, pauses in hidden tabs, and uses a static rendering for reduced motion. Firelight and [audio](audio.md) remain independently controlled parts of the room.

## Sharing and creating a room

GitHub and X icons sit at the lower left in the room’s muted parchment color. The header initially shows only the brand. After entry, its upper-right “Create your own Reading Room” action appears as a compact version of the same expanding-arrow component. It opens a native dialog explaining the Goodreads import experiment and inviting readers to reply with their Goodreads profile. Its “Reply on X” action opens the [launch thread](https://x.com/transitive_bs/status/2097328857926033415) in a new tab.

## Evaluation

Desktop composition and physical interaction are the current design priority. Judge weight, cover legibility, buried-book discovery, drag collisions, pickup and return, and grouping in the actual room. Responsive changes must preserve registration between the photograph, books, labels, shadows, and rain. Preserve keyboard focus when opening and closing the reading view.
