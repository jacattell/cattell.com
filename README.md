# cattell.com

James Arthur Cattell's personal website, rebuilt in November 2026 with security and accessibility first.

## How it fits together

| Address | What it is | Code | Hosted by |
| --- | --- | --- | --- |
| www.cattell.com | The website: plain files, no code runs | `content/`, `layouts/`, `assets/`, `static/` | Cloudflare Pages |
| api.cattell.com | The contact and feedback forms | `workers/public/` | Cloudflare Worker `cattell-public` |

Why it is built this way:

- **The website is only files.** [Hugo](https://gohugo.io/) turns Markdown into pages, so the build uses no npm packages that could be hijacked. The website sets no cookies.
- **The parts that run code are on their own address.** A problem with the forms can't touch the website.
- **Strict browser rules.** No inline scripts or styles, and nothing loads from other websites except Cloudflare's "Are you human?" check and visitor counter.
- **Accessible by design.** Large text, strong contrast in light and dark mode, no sideways scrolling at 400% zoom, and plain English. Every change is checked with [axe](https://github.com/dequelabs/axe-core) against WCAG 2.2 AA.

## Write a week note

Add a file at `content/week-notes/YEAR/WEEK.md`, for example `content/week-notes/2026/47.md`:

```markdown
---
title: "Week 47, 2026"
date: "2026-11-16"
summary: "New project, UKGovCamp planning"
---

## New project

It started on Monday...
```

- `date` is the Monday of the [ISO week](https://en.wikipedia.org/wiki/ISO_week_date).
- No leading zero in the file name: `7.md`, not `07.md`.
- A new year needs `content/week-notes/YEAR/_index.md`.
- Markdown can't contain HTML. For a YouTube video, write `{{< video id="VIDEO-ID" title="Title" >}}`.

## Where things are

| What | Where |
| --- | --- |
| Home page | `content/_index.md` |
| Work with me, accessibility, privacy | `content/delivery.md`, `content/accessibility.md`, `content/privacy.md` |
| Contact and feedback forms | `content/contact/`, `content/feedback/`, `workers/public/src/forms.js` |
| Week notes | `content/week-notes/` |
| Unconference guide | `content/unconference/` |
| Images | `static/assets/img/` |
| Menu, site settings | `hugo.toml` |
| Page design | `layouts/` and `assets/css/site.css` |
| Security headers | `static/_headers` |
| Old address redirects | `layouts/home.redirects` |

## Run it on your computer

You need [Node.js](https://nodejs.org/) 22 or later. There is nothing to `npm install`: `npm run build` downloads the Hugo version in `.hugo-version` and checks its checksum. For `npm run dev`, install [Hugo](https://gohugo.io/installation/) yourself.

```bash
npm run dev     # preview at http://localhost:1313
npm test        # build the site and run the tests
```

The tests include a page weight budget: under 100 KB of code and text per page, and no picture over 500 KB.

The accessibility check needs a browser:

```bash
npm ci --prefix test/a11y
npx --prefix test/a11y playwright install chromium
npm run build && node test/a11y/check.mjs public
```

GitHub Actions runs both on every pull request and every change to `main`. Links are checked every Monday.

## Licence

This repository uses two licences.

- **Code** is under the [MIT License](LICENSE). Code means everything that builds or runs the site, for example `layouts/`, `assets/`, `scripts/`, `workers/`, `lib/`, `test/`, `.github/` and the configuration files.
- **Content** is under [Creative Commons Attribution-ShareAlike 4.0](LICENSE-CONTENT) (CC BY-SA 4.0), unless it says otherwise. Content means the words and pictures, for example `content/`, `archive-data/` and the images in `static/assets/`.
