# Deploying

The game is served at <https://footy.pubdesking.uk> by Cloudflare Pages, from the project
`drunkfootball` (also reachable at `drunkfootball.pages.dev`). The project is connected to
this repository with the production branch set to `main`.

**Every push to `main` is a release.** There is no separate deploy step and no approval gate.

## The build config is not in this repo

Deliberately there is no `wrangler.toml`, no GitHub Actions workflow and no `_headers` file.
The whole configuration lives in the Cloudflare Pages project, so grepping this repository
will never reveal how it deploys. That is the reason this file exists.

Build command:

```sh
mkdir -p dist && for f in *; do [ "$f" = dist ] || cp -R "$f" dist/; done && rm -rf dist/*.md dist/tests.* dist/docs
```

| Setting | Value |
| --- | --- |
| Output directory | `dist` |
| Root directory | repository root |
| Framework preset | none |

There is no bundler and no `package.json`. Phaser is loaded from a CDN at runtime by
`index.html`, so nothing needs installing at build time.

## What is published

Published: `index.html`, `game.js`, `render.js`, `audio.js`, and `legacy/`.

Not published: `*.md` including the build spec, `tests.html`, `tests.js`, and `docs/`.
Dotfiles such as `.git` and `.gitignore` are excluded for free, because `for f in *` does not
match them.

This is about keeping the live domain to just the game. It is not a secrecy measure, the
repository is public, so anything excluded here is still readable on GitHub.

## Why the build excludes rather than includes

An include list would have to name every file that ships, and would silently drop new ones.
`audio.js` is exactly that case, it was added after the first version of this setup was
designed and an include list would have missed it, leaving a working-looking site with no
sound.

The trade is that **the publish set is open by default**. Any new top-level file that is not
a `.md`, a `tests.*` or `docs/` ships to the live domain automatically. After any structural
change that adds files or folders at the root, check the published file list.

`tests.html` and `tests.js` are excluded on purpose and should stay that way. The suite boots
the real game and hammers it with thousands of simulated kicks and match restarts, so on a
phone over mobile data it is a good way to flatten someone's battery. It also reports internal
state, and if it ever failed in public it would read as the game being broken.

## `legacy/` must stay inside the publish root

`game.js` sends players to the old build with a relative `LEGACY_URL = 'legacy/'`, and
`legacy/index.html` links back with `<a href="../">`. Both are resolved relative to the
publish root, so `legacy/` has to be copied inside `dist/`. If the site is ever restructured,
`legacy/` moves with it or the LEGACY MODE menu item starts 404ing.

## Verifying a deploy

**A 200 does not mean the site works.** There is no `404.html`, so Pages falls back to
serving `index.html` for any unknown path, with status 200.

That matters more here than on most projects. Every script is referenced relatively by name,
macOS is case-insensitive and the Pages build runs on Linux. So a mis-cased reference like
`src="Render.js"` returns 200, with an HTML body under a JavaScript content type, the parse
fails silently, and the page renders blank. Nothing in the response headers looks wrong.

Load the deployed page and check in the console:

```js
window.game.isBooted          // true
typeof CONFIG                 // not 'undefined'
typeof Renderer               // not 'undefined'
Phaser.VERSION                // the version index.html asks for
```

Then confirm `/legacy/` returns the page titled "Drunk Football — old version", and that
`/tests.js` comes back as the `index.html` fallback rather than real JavaScript, which proves
the exclusions are still working.

## DNS

The domain is a proxied `CNAME` on the `pubdesking.uk` zone:

```
footy  CNAME  drunkfootball.pages.dev   (proxied)
```

Attaching a custom domain in Pages normally creates this record automatically. If it does not,
the domain sits at `pending` and the record has to be added by hand, which is what happened
here, the API credentials in use had no DNS permission on the zone.
