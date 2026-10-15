# srb
My personal website — [scottblackmore.com](https://scottblackmore.com/)

A super basic HTML website, with minimal JavaScript and CSS. There is no build step: every file in the repo is served as-is.

## Structure

| Path | Purpose |
| --- | --- |
| `*.html` | One file per page, served at clean URLs (`/about` → `about.html`). `404.html` and `500.html` are the error pages. |
| `styles.css` | The only stylesheet, shared by every page. |
| `main.js` | Shared behaviour: mobile menu, footer year, and the gallery grid. |
| `lastfm.js` | Shared Last.fm helpers (JSONP requests, latest track), used by the music page and the night drive. |
| `music.js` | Music page only: loads listening data from the Last.fm API. |
| `night-drive.js` | The night drive: a full-screen canvas scene with a car radio showing what's playing. Loaded on demand from the header car icon, the home page button, typing "drive", or any URL ending in `#drive`. |
| `rabbit-hole.js` | The footer's "Fall down a rabbit hole" card: a random Wikipedia article, then random links onward. Loaded on demand. |
| `assets/images/icons.svg` | Social icon sprite, used as `<svg><use href="/assets/images/icons.svg#github" /></svg>`. |
| `instagram_sync.py` | Local script that pulls recent Instagram posts into the gallery. |

The header and footer are repeated in every page, so menu or social-link changes need to be made in each `.html` file.

## Previewing locally

Pages use root-relative paths (`/styles.css`), so open them through a local server rather than straight from disk:

```sh
npx serve .            # or: python -m http.server
```

With `python -m http.server`, use `/about.html` rather than `/about`, since it doesn't serve clean URLs.

## Gallery sync

`instagram_sync.py` downloads new posts with [Instaloader](https://instaloader.github.io/), saves them under `assets/images/gallery/`, and rewrites the `items` list in `main.js` between the `// gallery-items:start` and `// gallery-items:end` markers.

```sh
pip install instaloader requests
INSTA_USERNAME=... INSTA_PASSWORD=... python instagram_sync.py
```

Login sessions, sync state and logs stay local and are git-ignored.

## Music page

`music.js` uses Last.fm's public API key for user `Jegethy`. The "Now Playing" block needs recent listening to be public: on Last.fm, untick **Settings → Privacy → Hide recent listening information**.
