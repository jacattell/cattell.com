# cattell.com

James Arthur Cattell's personal website. It was moved here from Google Sites in November 2026.

- Pages are written in Markdown, in the `src` folder.
- [Eleventy](https://www.11ty.dev/) turns them into a website, in the `_site` folder.
- A small Node.js server (`server/`) serves that website and runs the [Chat with Claude](https://www.cattell.com/chat/) page.

## Write a week note

1. Add a file at `src/week-notes/YEAR/WEEK.md`, for example `src/week-notes/2026/45.md`.
2. Write the note in Markdown. Do not add a title: the page is titled "Week 45, 2026" for you.
3. Optional: add a one-line summary at the top. It shows on the week notes index and in the feed.

```markdown
---
summary: "New project, UKGovCamp planning"
---

- covers 2 to 8 November 2026.

## New project

It started on Monday...
```

Commit and push. The note then appears on the index, its year page, the home page and the feed, with links to the notes before and after it.

Week numbers are [ISO weeks](https://en.wikipedia.org/wiki/ISO_week_date). Use 2 digits for the file name (`07.md`).

To set a goal for a year, edit `src/_data/goals.json`.

## Where things are

| What | Where |
| --- | --- |
| Home page | `src/index.md` |
| Delivery, Contact | `src/delivery.md`, `src/contact.md` |
| Week notes | `src/week-notes/YEAR/WEEK.md` |
| Text at the bottom of the week notes index | `src/week-notes/index.md` |
| Unconference book and posts | `src/unconference/` |
| How-to pages | `src/how-to/` |
| Images | `src/assets/img/` (see [IMAGES.md](IMAGES.md) for ones still to add) |
| Menu, site name | `src/_data/site.json` |
| Page design | `src/_includes/layouts/` and `src/assets/css/site.css` |
| Chat page | `src/chat.njk`, `src/assets/js/chat.js`, `server/chat.js` |

## Run it on your computer

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
```

To write and preview pages (the chat page will not work in this mode):

```bash
npm run dev
```

To run the full site, including chat:

```bash
npm run build
```

```bash
ANTHROPIC_API_KEY=your-key npm start
```

Then open http://localhost:3000. To run the tests:

```bash
npm test
```

## Hosting on SiteGround

The site runs as one SiteGround **Node.js Project**, linked to this GitHub repository. Each push to the `main` branch rebuilds and redeploys it.

Settings for the project (in Site Tools > Node.js):

| Setting | Value |
| --- | --- |
| Repository and branch | `jacattell/cattell.com`, `main` |
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Node.js version | 20 or newer |

The server listens on the port given in the `PORT` environment variable (3000 if it is not set).

Environment variables:

| Name | Needed? | What it does |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | For chat | Key from the [Claude Console](https://platform.claude.com/). Without it the site works and the chat page says it is not set up. |
| `CHAT_MODEL` | No | Claude model to use. Default `claude-haiku-5-5`. |
| `CHAT_PER_MINUTE` | No | Messages one visitor can send per minute. Default 6. |
| `CHAT_PER_DAY` | No | Messages one visitor can send per day. Default 40. |
| `CHAT_DAILY_LIMIT` | No | Messages all visitors together can send per day. Default 300. |

Never put the API key in this repository. Set a monthly spend limit for the key in the Claude Console as well.

## The chat page

- The browser sends the conversation to `/api/chat`. The server adds a copy of the main pages (`_site/chat-context.txt`, made at build time) and passes it to Claude through the Anthropic API.
- The server does not store conversations. Anthropic handles them under its own terms.
- Conversations are limited to 20 messages of up to 2,000 characters each.

## Old addresses

Addresses from the Google Sites version, such as `/week-notes/2026-week-14`, redirect to the new ones (`/week-notes/2026/14/`). See `server/static.js`.

## Licence

See [LICENSE](LICENSE).
