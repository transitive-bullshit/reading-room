# The Reading Room

Brand identity for future site design, README updates, and marketing assets.

- **Brand name:** The Reading Room
  - Literal, welcoming, and quietly atmospheric. It names a place you’d like to spend time, without asking your bookshelf to make a statement.
- **Mantra:** Make yourself at home.
- **One-liner:** A cozy home for your favorite books
- **Vibe:** A comfortable chair, warm lamplight, rain outside, and familiar books within reach.
- **Voice:** Warm, simple, unhurried. More “come in, get comfortable” than literary manifesto.

No separate descriptive one-liner is needed.

## Logo and icon

The selected **Open Book** treatment pairs an open book and a lifted-page flourish with a warm serif wordmark. The lettering is saved as vector outlines, so no font installation is required.

| Asset | SVG | Transparent PNG |
| --- | --- | --- |
| Logo, parchment | [logo.svg](../public/brand/logo.svg) | [logo.png](../public/brand/logo.png) |
| Icon, parchment | [icon.svg](../public/brand/icon.svg) | [icon.png](../public/brand/icon.png) |
| Logo, dark | [logo-dark.svg](../public/brand/logo-dark.svg) | [logo-dark.png](../public/brand/logo-dark.png) |
| Icon, dark | [icon-dark.svg](../public/brand/icon-dark.svg) | [icon-dark.png](../public/brand/icon-dark.png) |

Use parchment (`#E2CEAA`) on the reading room photograph and other dark backgrounds. Use dark walnut (`#35261D`) on light backgrounds. Prefer SVG for the site and scalable artwork; PNG logos are 2400 px wide and icons are 1024 px wide.

The isolated icon is tightly cropped with no horizontal padding. Preserve its proportions and apply any layout spacing outside the asset. Square favicons fill the full width, with only the vertical space needed to center the wider book shape.

Next.js automatically registers [app/icon.svg](../app/icon.svg) for SVG-capable browsers and [app/favicon.ico](../app/favicon.ico) as the fallback. The ICO contains optimized 16, 32, and 48 px versions. Keep `app/icon.svg` identical to the parchment brand icon when updating the artwork.

## Social image and README banner

Both images combine the reading room background, the parchment Open Book logo, and a small pile of books. Keep these compositions simple: no extra slogans, badges, or interface elements.

| Asset | Dimensions | Use |
| --- | --- | --- |
| [Open Graph social image](../app/opengraph-image.jpg) | 1200 × 630 px | Link previews; Next.js registers it automatically from `app/`, with [companion alt text](../app/opengraph-image.alt.txt) |
| [README banner](assets/readme-banner.jpg) | 1600 × 600 px | Wide project header, used in the [README](../readme.md) |

The social composition centers the books below the logo. The wider banner places the books to the right. Both are optimized JPEGs; preserve their aspect ratios when reusing them.
