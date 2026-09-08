# The Reading Room

![The Reading Room — a cozy home for your favorite books](docs/assets/readme-banner.jpg)

Use Node.js 24 or newer and pnpm.

```sh
pnpm install
pnpm dev
```

[Portless](https://portless.sh) runs the development server at [book-library.localhost:1355](http://book-library.localhost:1355). Open [The Reading Room](http://book-library.localhost:1355/prototypes/reading-room?v=2) for the interactive book piles.

Portless starts its local HTTP proxy on port 1355 automatically and assigns an available port to Next.js. This configuration avoids certificate trust, administrator access, and hosts-file changes. Git worktrees use separate prefixed hostnames; the terminal prints the URL. Chrome and Firefox resolve `.localhost` hostnames directly.

To run Next.js directly for troubleshooting, use `PORTLESS=0 pnpm dev`.

```sh
pnpm test
pnpm build
```

The scene uses Three.js for rendering and Rapier (`@dimforge/rapier3d-compat`) for rigid-body physics. Start with the [project documentation](docs/README.md) for design decisions, physics, audio, and asset organization.

`public/` holds runtime assets. `app/` also contains the Next.js browser icons and social image. `docs/` holds lasting project context, the README banner, and a concept reference. Large source masters, abandoned room experiments, generation logs, and review artifacts live locally in `work/`, which is ignored by Git and excluded from TypeScript checks.
