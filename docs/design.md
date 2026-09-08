# Reading room design

The reading table makes book discovery physical: readers move through a heap, uncover a title, and open a clear reading surface. The After Hours photograph, warm light, matte books, and restrained controls establish the room's character.

Read [physics.md](physics.md) when changing movement or scene registration, [audio.md](audio.md) for sound behavior, and [assets.md](assets.md) for sources and retained files. Runtime code remains under `app/prototypes/reading-room/`.

## Collection and reading surfaces

The Pile contains 25 curated five-star reads. The Big Pile contains all 86 five-star records, including distinct editions. Equal ratings do not imply a ranking. Both share the same room and interaction model.

The library searches all 192 imported books, with rating filters and sorting. The ivory detail view is the full reading surface: preserve complete descriptions, source date precision, and edition-specific Goodreads and Amazon links. The Amazon action reads “View on Amazon.” Original covers remain available to these views.

Physical books use the original cover proportions, page-count-based thickness and mass, separate cover boards and page blocks, binding, and contact shadows. Their desk textures use restrained paper grain, wear, and warm/cool illumination. Both covers show the artwork; the back is inverted and mirrored so a face-down book remains identifiable.

## Grouping

Only The Big Pile offers Free pile, Genre, Author, and Published. Every arrangement retains every book exactly once. Organized modes create at most six labeled groups, with larger groups spread across adjacent stacks.

Each organized pile label is a button. Choosing it moves the other books beyond the table and spreads that group's covers into fitted rows. The largest group has 24 books; apply a shared size adjustment when needed to expose every cover with space between books. A breadcrumb below the grouping controls names the current category. Its “All genres,” “All authors,” or “All years” button brings the complete collection back into the same grouping. The table count reflects the visible group.

Changing grouping, switching prototypes, or replaying clears the category selection. Replay keeps the grouping mode. Book details and the full library remain available. Keyboard users can choose pile labels, reach the breadcrumb, and pick up only the books currently on the table.

- Genre favors specific classifications such as LitRPG or Space opera over broad shelves and format labels. Small categories may share a clearly named group.
- Author uses the primary author contributor, excluding translators and narrators. Matching author URLs establish name aliases. Balanced ranges keep each author's books together.
- Published prefers first publication and falls back to the edition date. Preserve the original year, month, or day precision. Balance complete years into ranges; older ranges occupy the left column pair, then the middle and right pairs.

Free pile returns to the initial naturally settled heap, including its leaning books and varied headings. It uses a shallow rearrangement. Page load and Replay provide the visible drop from above the frame. Replay preserves the selected grouping.

## Interaction and atmosphere

Dragging should feel responsive and weighted. A held book turns toward the reader while remaining able to collide and deflect. Released books keep the orientation produced by contact. Clicking a buried book scatters the covering books, extracts the selection, and aligns its cover with the camera before opening the detail view.

A warm tabletop pool follows the hovered, focused, or held book. A faint warm gray glow hugs an active book's physical edges and follows its tilt. The table artwork suppresses browser text selection and image dragging; the detail view preserves ordinary HTML reading and focus behavior.

Window rain is confined to eleven glass panes, leaving the mullions, frame, sill, and lamp clear. Its geometry follows the photograph's centered cover fit and scene scaling. Rain has a separate visual toggle, pauses in hidden tabs, and uses a static rendering for reduced motion. Firelight and [audio](audio.md) remain independently controlled parts of the room.

## Evaluation

Desktop composition and physical interaction are the current design priority. Judge weight, cover legibility, buried-book discovery, drag collisions, pickup and return, and grouping in the actual room. Responsive changes must preserve registration between the photograph, books, labels, shadows, and rain. Preserve keyboard focus when opening and closing the reading view.
