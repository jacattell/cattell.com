# cattell.com

James Arthur Cattell's personal website. It was moved here from Google Sites in November 2026.

- Pages are written in Markdown, in the `src` folder.
- [Eleventy](https://www.11ty.dev/) turns them into a website, in the `_site` folder.
- [Cloudflare Pages](https://pages.cloudflare.com/) hosts it. A small function (`functions/` and `lib/`) runs the [Chat with Claude](https://www.cattell.com/chat/) page.

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
| Chat page | `src/chat.njk`, `src/assets/js/chat.js`, `lib/chat.js` |
| Old address redirects | `src/_redirects.njk` |

## Run it on your computer

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
```

To write and preview pages (the chat page will not work in this mode):

```bash
npm run dev
```

To run the full site as Cloudflare would, including chat:

```bash
npx wrangler pages dev --binding ANTHROPIC_API_KEY=your-key
```

Run `npm run build` first. Then open http://localhost:8788. To run the tests:

```bash
npm test
```

## Hosting on Cloudflare Pages

Cloudflare builds and publishes the site each time you push to `main`. The free plan is enough.

### Set it up (once)

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com/).
2. Go to **Workers & Pages**, choose **Create**, then the **Pages** tab, then **Connect to Git**.
3. Connect your GitHub account and choose `jacattell/cattell.com`.
4. Use these build settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `_site` |

5. Under **Environment variables**, add `NODE_VERSION` with the value `22`.
6. Choose **Save and Deploy**. The site appears at an address like `cattell-com.pages.dev`.

### Turn on chat

1. Create an API key in the [Claude Console](https://platform.claude.com/) and set a monthly spend limit on it.
2. In Cloudflare, open the project, then **Settings** > **Variables and Secrets**.
3. Add `ANTHROPIC_API_KEY` as a **Secret** (so it is hidden), for Production.
4. Redeploy (**Deployments** > latest > **Retry deployment**) so the change takes effect.

Never put the API key in this repository.

Optional: add `CHAT_MODEL` to use a different Claude model. The default is `claude-haiku-5-5`.

### Limit chat use

The function slows down a single visitor who sends lots of messages, but Cloudflare runs many copies of it, so this is not a firm limit. For firm limits:

- the spend limit on the API key caps what you can be charged
- a free Cloudflare rate limiting rule caps messages per visitor: once cattell.com is on Cloudflare, go to **Security** > **WAF** > **Rate limiting rules** and add a rule for requests whose URI path equals `/api/chat`, for example 10 requests per minute per IP address

### Use cattell.com

In the project, go to **Custom domains** and add `cattell.com` and `www.cattell.com`. Cloudflare explains the steps.

The simplest way is to move the domain's DNS to Cloudflare (free). Your email at cattell.com runs on Google Workspace, so before you switch, check that Cloudflare has copied every existing DNS record, especially the `MX`, `TXT` (SPF, DKIM, DMARC) and any Google verification records. If those are missing, email stops working.

Only switch once the `pages.dev` version looks right. Keep Google Sites until then.

## The chat page

- The browser sends the conversation to `/api/chat`. The function adds a copy of the main pages (`_site/chat-context.txt`, made at build time) and passes it to Claude through the Anthropic API.
- The function does not store conversations. Anthropic handles them under its own terms.
- Conversations are limited to 20 messages of up to 2,000 characters each.

## Old addresses

Addresses from the Google Sites version, such as `/week-notes/2026-week-14`, redirect to the new ones (`/week-notes/2026/14/`). The rules are made at build time by `src/_redirects.njk`.

## Licence

See [LICENSE](LICENSE).
