## Conventions

- use `pnpm`
- use modern typescript
- no semicolons
- oxfmt for formatting (`pnpm fix:format`)
- oxlint for linting (`pnpm fix:lint`)

## Context

- For interface changes, read [the design decisions](docs/design.md).
- For book motion, collisions, or grouping, read [the physics context](docs/physics.md).
- For sound behavior or sample changes, read [the audio context](docs/audio.md).
- For adding, replacing, or moving assets, read [the asset layout](docs/assets.md).
- Keep lasting documentation in `docs/`.
- Keep temporary experiments, source masters, and review artifacts in the git-ignored `work/` directory.
- `public/` contains assets served by the site.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
