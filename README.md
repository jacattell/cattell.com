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
| Hidden stuff page and Bitwarden guide | `src/hidden/` |
| Images | `src/assets/img/` |
| Menu, site name | `src/_data/site.json` |
| Page design | `src/_includes/layouts/` and `src/assets/css/site.css` |
| Chat page | `src/chat.njk`, `src/assets/js/chat.js`, `lib/chat.js` |
| Old address redirects | `src/_redirects.njk` |

## Social media archive

`/archive/` is a searchable archive of posts from Bluesky, LinkedIn, Mastodon and X (Twitter). Posts shared on more than one platform within 20 minutes, with mostly the same words, are shown once with a link to each platform.

| What | Where |
| --- | --- |
| Saved posts, one file per platform | `archive-data/` |
| Saved copies of images | `src/assets/archive/`, listed in `archive-data/media.json` |
| Scripts that download posts and copy images | `scripts/archive/` |
| How cross-posts are matched | `lib/archive.js` |
| Pages | `src/archive/`, `src/_includes/archive-post.njk` |
| Search | `src/assets/js/archive.js` |

Images are copied into the site, so the archive does not depend on Bluesky or Mastodon keeping them. Each is saved once, as a web-sized picture and a small preview, with hidden data such as location removed. YouTube video thumbnails are copied too; a video that has been deleted or made private gets no preview. Videos themselves are not copied: they still link to, or play from, the platform they were posted on.

To collect new posts and copy their images:

```bash
npm run archive:fetch
```

Add `--all` to a script to download every post again rather than just new ones. Only public Mastodon posts are saved; private posts and direct messages never are.

### X (Twitter)

X has no free way to download posts, so they come from an archive download instead (X: **Settings** > **Your account** > **Download an archive of your data**). Only `data/tweets.js` from the download is needed; keep it out of this repo, as it's over 100 MB.

```bash
node scripts/archive/import-x.js path/to/tweets.js
```

```bash
node scripts/archive/fetch-media.js
```

Retweets are left out; your own tweets, threads and replies are kept. The archive has no image descriptions. Images X no longer has are shown as "Image: no longer available", with a link to the tweet.

Because there are so many posts:

- year pages show 200 posts each, with links to newer and older pages
- the search page only downloads the posts (about 2.5 MB) once someone starts to search
- the chat leaves out posts that are only on X, so its input stays under 100,000 tokens

### LinkedIn

LinkedIn has no way to download posts except its data export (LinkedIn: **Settings** > **Data privacy** > **Get a copy of your data** > the larger archive). Only `Shares.csv` (posts) and `Rich_Media.csv` (their photos) are used; the rest of the export, such as messages and connections, is never read. Keep the export out of this repo.

```bash
node scripts/archive/import-linkedin.js path/to/Shares.csv path/to/Rich_Media.csv
```

```bash
node scripts/archive/fetch-media.js
```

Run the second straight after the first: the photo links in the export stop working after about a week.

The export doesn't say who could see each post, so the import opens each one on LinkedIn without signing in. Posts that ask you to sign in (connections-only posts, group posts and some very old posts) are left out. Posts already saved are not checked again. lnkd.in short links are replaced with where they go. LinkedIn videos are not copied.

## Contact and feedback forms

The contact form (on `/contact/`) and the feedback form (`/feedback/`) email each answer to you through [Resend](https://resend.com). Nothing is stored on the website. Spam protection: an "are you human" check ([Cloudflare Turnstile](https://www.cloudflare.com/application-services/products/turnstile/)), a hidden spam trap, and a limit of 5 forms per visitor per hour.

| What | Where |
| --- | --- |
| Forms | `src/contact.md`, `src/feedback.njk` |
| Thank-you pages | `src/contact-thanks.njk`, `src/feedback-thanks.njk` |
| Checking answers and sending them | `lib/forms.js`, `functions/api/form.js` |

### Set up Resend (once)

1. Sign up at [resend.com](https://resend.com). The free plan allows 3,000 emails a month.
2. Go to **Domains**, choose **Add Domain**, and enter `updates.cattell.com` (the forms send from `forms@updates.cattell.com`). Choosing the Ireland (EU) region keeps answers in Europe.
3. Resend shows a few DNS records for `updates.cattell.com`. Add them where the cattell.com DNS is managed. They sit alongside your Google Workspace email records: do not change or remove any existing `MX` or `TXT` records for `cattell.com` itself.
4. Wait for Resend to show the domain as **Verified**.
5. Go to **API Keys**, choose **Create API Key**, give it **Sending access** for `updates.cattell.com` only, and copy the key.
6. In Cloudflare, open the Pages project, then **Settings** > **Variables and Secrets**, and add for Production:
   - `RESEND_API_KEY`: the key, as a **Secret**
   - `FORM_TO`: the address to send answers to, for example `james@cattell.com`
7. Redeploy (**Deployments** > latest > **Retry deployment**), then send yourself a test message from each form.

Optional: `FORM_FROM` changes who the emails come from. The default is `cattell.com forms <forms@updates.cattell.com>`; any other address must be on a domain verified in Resend.

Until this is set up, the forms show a message asking people to email you instead.

### Set up the "are you human" check (once)

1. In Cloudflare, go to **Turnstile** and choose **Add widget**.
2. Name it `cattell.com forms`, add the hostname `www.cattell.com`, and choose **Managed** mode. Most people then just see a box that ticks itself.
3. Copy the **site key** and the **secret key**.
4. In the Pages project, go to **Settings** > **Variables and Secrets**, and add for Production:
   - `TURNSTILE_SITE_KEY`: the site key (it's public, so it can be a plain variable or a secret)
   - `TURNSTILE_SECRET_KEY`: the secret key, as a **Secret**
5. Redeploy. The check appears above the Send button on both forms.

The check is only used when both keys are set; with one missing, the forms work without it. The check needs JavaScript; people who can't use it are asked to email you instead.

## Hidden GOV.UK Design System version

Every page also has a copy at `/govuk/…` (for example `/govuk/week-notes/`) styled with [GOV.UK Frontend](https://frontend.design-system.service.gov.uk/). Nothing on the main site links to it, and it tells search engines not to list it.

- The copies are built from the same pages, so editing a page updates both versions.
- The GOV.UK crown, logo and GDS Transport font may only be used on GOV.UK services, so the copy uses GOV.UK Frontend's styles with an ordinary font and none of those brand assets.
- Forms in the copy send answers the same way, but their thank-you pages are the main site's.

| What | Where |
| --- | --- |
| Page layout | `src/_includes/layouts/govuk.njk` |
| Copies of the pages | `src/govuk/pages.njk`, `src/govuk/*-years.njk` |
| Styles | `src/govuk/govuk.scss` |
| Restyling each page's content | the `govuk-version` transform in `eleventy.config.js` |

## Week notes editor

`/edit/` is a page for writing and editing week notes in your browser. Sign in with GitHub; only the accounts in `EDITORS` (default: `jacattell`) are let in. "Save and publish" saves the note to the `main` branch on GitHub, and Cloudflare publishes it in about a minute. The page is not linked from the site and is hidden from search engines.

Only week note files (`src/week-notes/YEAR/WEEK.md`) can be changed. Your GitHub sign-in is kept in an encrypted cookie that page scripts cannot read, and lasts 8 hours.

| What | Where |
| --- | --- |
| Page and script | `src/edit/index.njk`, `src/assets/js/edit.js` |
| Sign-in, reading and saving notes | `lib/editor.js`, `functions/api/auth/`, `functions/api/edit/` |

### Set up GitHub sign-in (once)

Use a GitHub App, so a sign-in can only ever change this repository.

1. On GitHub, go to **Settings** > **Developer settings** > **GitHub Apps** > **New GitHub App**.
2. Fill in:
   - GitHub App name: `cattell-com-editor` (it must be unique on GitHub)
   - Homepage URL: `https://www.cattell.com`
   - Callback URL: `https://www.cattell.com/api/auth/callback`
   - Leave **Expire user authorization tokens** ticked.
   - Webhook: untick **Active**.
   - Repository permissions: **Contents: Read and write**. Leave everything else as "No access".
   - Where can this GitHub App be installed: **Only on this account**.
3. Choose **Create GitHub App**, then **Generate a new client secret**. Copy the **Client ID** and the secret.
4. Choose **Install App** (left menu) > **Install**, pick **Only select repositories** > `jacattell/cattell.com`, and choose **Install**.
5. In Cloudflare, open the Pages project, then **Settings** > **Variables and Secrets**, and add for Production:
   - `GITHUB_CLIENT_ID`: the client ID
   - `GITHUB_CLIENT_SECRET`: the client secret, as a **Secret**
   - `SESSION_SECRET`: a long random string (at least 32 characters), as a **Secret**. A password manager can generate one.
6. Redeploy (**Deployments** > latest > **Retry deployment**), then go to `/edit/` and sign in.

An older OAuth App also works, but its sign-in can change all your public repositories.

Signing out cancels the GitHub key straight away. Sign-out only works from the editor's own button, so other sites can't sign you out.

## Security headers

`src/_headers.njk` makes the `_headers` file Cloudflare uses.

Every page has a Content-Security-Policy that only lets the browser run this site's own scripts and styles, plus:

- Cloudflare's human check (Turnstile) on the forms
- Cloudflare Web Analytics, which Cloudflare adds to the live site (not when running it on your computer)
- YouTube's privacy-enhanced player (`youtube-nocookie.com`), in the archive and week notes
- images from any secure (`https:`) address

The few small inline scripts (the light/dark script, and two on the GOV.UK version) live in `src/_includes/` and are allowed by their hashes, worked out at build time, so editing them is safe. No page may show another site inside it. The editor pages (`/edit/`) have an even stricter policy on top.

A test checks every built page: if a page gets an inline script, style or event attribute, or embeds a frame from anywhere but YouTube's privacy-enhanced player, the tests fail. To embed something else, add its address to `frame-src` (or the right part of the policy) in `src/_headers.njk`.

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
- a free Cloudflare rate limiting rule caps messages per visitor: go to the cattell.com **Security** > **WAF** > **Rate limiting rules** and add a rule for requests whose URI path equals `/api/chat`, for example 10 requests per minute per IP address

### Use cattell.com

The domain is registered with Cloudflare and its DNS is managed there. Email runs on Google Workspace, so never delete the `MX` or `TXT` records.

1. Check the `pages.dev` version looks right.
2. In the Pages project, go to **Custom domains** and add `www.cattell.com`. Cloudflare offers to replace the existing `www` record (which points to Google Sites). Accept.
3. Add `cattell.com` as a custom domain too.
4. Make `cattell.com` redirect to `www.cattell.com`: go to the cattell.com **Rules** > **Redirect Rules**, and use the "Redirect from root to WWW" template.

To go back to Google Sites, remove the custom domains and set the `www` record back to a `CNAME` pointing to `ghs.googlehosted.com`, with the proxy turned off (grey cloud).

## The chat page

- The browser sends the conversation to `/api/chat`. The function adds a copy of the main pages (`_site/chat-context.txt`, made at build time) and passes it to Claude through the Anthropic API.
- The function does not store conversations. Anthropic handles them under its own terms.
- Conversations are limited to 20 messages of up to 2,000 characters each.
- **Chat logs:** when the `CHAT_LOGS` KV binding is set, each conversation's questions and answers are saved (no IP address or other details), and Cloudflare deletes each one automatically 30 days after its last message. The Chat page tells visitors this. Read them at `/edit/chats/`, signing in with GitHub as for the week notes editor. The code is in `lib/chat.js` (saving), `lib/editor.js` (reading) and `src/assets/js/chat-logs.js`.

### Chat logs storage

Conversations are kept in the Cloudflare KV namespace `cattell-chat-logs`, connected as `CHAT_LOGS` in `wrangler.toml`. To use a different namespace, change its `id` there.

Without the binding, nothing is saved and the chat works as before.

## Old addresses

Addresses from the Google Sites version, such as `/week-notes/2026-week-14`, redirect to the new ones (`/week-notes/2026/14/`). The rules are made at build time by `src/_redirects.njk`.

## Licence

See [LICENSE](LICENSE).
