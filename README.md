# cattell.com

James Arthur Cattell's personal website, rebuilt in November 2026 with security and accessibility first.

## How it fits together

| Address | What it is | Code | Hosted by |
| --- | --- | --- | --- |
| www.cattell.com | The website: plain files, no code runs | `content/`, `layouts/`, `assets/`, `static/` | Cloudflare Pages |
| api.cattell.com | "Ask my AI" and the contact and feedback forms | `workers/public/` | Cloudflare Worker `cattell-public` |
| admin.cattell.com | Your private tools: week notes editor, chat logs, Claude sessions | `workers/admin/` | Cloudflare Worker `cattell-admin`, behind Cloudflare Access |

Why it is built this way:

- **The website is only files.** [Hugo](https://gohugo.io/) turns Markdown into pages. Hugo is one program, so building the site uses no npm packages that could be hijacked. Visitors get plain HTML, one CSS file and a few small scripts.
- **The parts that run code are on their own addresses.** A problem with the chat can't touch the website or your private tools. The website sets no cookies.
- **Your private tools have two locks.** Cloudflare Access asks you to sign in (with 2-step verification) before anything reaches them. The Worker then checks Access's signed sign-in again on every request, so a mistake in the Access settings still can't expose anything. There is no sign-in code of our own to get wrong.
- **The editor saves as a GitHub App** (`cattellcom-editor`) that can only change files in this repository. No personal GitHub key is stored.
- **Strict browser rules.** Every page forbids inline scripts and styles, and loads nothing from other websites except Cloudflare's "Are you human?" check and visitor counter. The admin pages also use [Trusted Types](https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API).
- **Accessible by design.** Large text, short lines, the GOV.UK focus style, strong contrast in light and dark mode, no sideways scrolling at 400% zoom, and plain English. Every change is checked with [axe](https://github.com/dequelabs/axe-core) against WCAG 2.2 AA (`test/a11y/check.mjs`).

## Write a week note

The easy way: go to [admin.cattell.com](https://admin.cattell.com), sign in, and choose **Start note**.

Or add a file at `content/week-notes/YEAR/WEEK.md`, for example `content/week-notes/2026/47.md`:

```markdown
---
title: "Week 47, 2026"
date: "2026-11-16"
summary: "New project, UKGovCamp planning"
---

- covers 16 to 22 November 2026.

## New project

It started on Monday...
```

- `date` is the Monday of the week. Week numbers are [ISO weeks](https://en.wikipedia.org/wiki/ISO_week_date). The editor fills in the title and date for you.
- The file name has no leading zero: `7.md`, not `07.md`.
- A new year needs `content/week-notes/YEAR/_index.md` (the editor adds it). To set a goal for the year, add `goal: "..."` to that file.
- Markdown can't contain HTML. For a YouTube video, write `{{< video id="VIDEO-ID" title="Title" >}}`. It shows as a link, so no YouTube code loads on the site.

## Where things are

| What | Where |
| --- | --- |
| Home page | `content/_index.md` |
| Work with me, accessibility, privacy | `content/delivery.md`, `content/accessibility.md`, `content/privacy.md` |
| Contact and feedback forms | `content/contact/`, `content/feedback/`, `layouts/form.html` |
| Ask my AI | `content/chat.md`, `layouts/chat.html`, `assets/js/chat.js`, `workers/public/src/chat.js` |
| Week notes | `content/week-notes/YEAR/WEEK.md` |
| Unconference guide | `content/unconference/` (chapters have `chapter: true` and a `weight` for their order) |
| Hidden pages | `content/hidden/` |
| Images | `static/assets/img/` |
| Menu, site settings | `hugo.toml` |
| Page design | `layouts/` and `assets/css/site.css` |
| Security headers | `static/_headers` |
| Old address redirects | `layouts/home.redirects` |
| What the AI chat reads | `layouts/home.chatcontext.txt` (built as `/chat-context.txt`) |
| Places on the feedback form | `data/forms.yaml` and `WORKED_ON` in `workers/public/src/forms.js` (a test checks they match) |

## Run it on your computer

You need [Node.js](https://nodejs.org/) 22 or later and [Hugo](https://gohugo.io/installation/) (the version in `.hugo-version`). There is nothing to `npm install`.

```bash
npm run dev     # preview at http://localhost:1313
npm test        # build the site and run the tests
```

The accessibility check needs a browser, so it has its own packages (used only for testing):

```bash
npm ci --prefix test/a11y
npx --prefix test/a11y playwright install chromium
npm run build && node test/a11y/check.mjs public
```

GitHub Actions runs both on every pull request and every change to `main` (`.github/workflows/test.yml`). Links are checked every Monday (`.github/workflows/links.yml`).

If you change `assets/css/site.css`, run `npm run admin:css` so the admin pages match.

## Switching over

These are the steps to move from the old Eleventy site to this one. Do them in this order, so nothing stops working.

Until the pull request is merged, the `workers/` folders are only on the `claude/redesign` branch. So for each Worker, after creating it, go to its **Settings** > **Build** > **Branch control** and set the production branch to `claude/redesign`. After merging, set it back to `main` (step 6). Plain settings (not secrets) can be seen in each `wrangler.jsonc`.

### 1. Make the public Worker (api.cattell.com)

1. In Cloudflare, go to **Workers & Pages** > **Create** > **Import a repository**, and choose `jacattell/cattell.com`.
2. Set **Project name** to `cattell-public` and **Root directory** to `workers/public`. Leave the build command empty. Deploy command: `npx wrangler deploy`.
3. When it has deployed, open **Settings** > **Variables and Secrets** and add these as **Secrets**. Copy the values from the old Pages project's settings:
   - `ANTHROPIC_API_KEY`
   - `RESEND_API_KEY`
   - `FORM_TO`
   - `TURNSTILE_SITE_KEY`
   - `TURNSTILE_SECRET_KEY`
4. Check https://api.cattell.com opens www.cattell.com.

The Worker adds `api.cattell.com` itself (from `wrangler.jsonc`). It refuses requests that don't come from www.cattell.com, limits each visitor to 6 chat messages a minute and 40 a day, and stops the chat for the day after 500 messages from everyone (`CHAT_DAILY_CAP`).

### 2. Turn on Cloudflare Access for admin.cattell.com

1. In Cloudflare, go to **Zero Trust**. If asked, choose a team name (for example `cattell`) and the free plan.
2. **Settings** > **Authentication** > **Login methods**: add **Google** (or keep **One-time PIN**, which emails you a code).
3. **Access** > **Applications** > **Add an application** > **Self-hosted**:
   - Name: `Admin`. Domain: `admin.cattell.com`. Session duration: 24 hours.
   - Policy: **Allow**, Include **Emails**: your email address.
   - Save, then open the application and copy its **Application Audience (AUD) Tag**.
4. Add a second **Self-hosted** application for the session uploads:
   - Name: `Admin uploads`. Domain: `admin.cattell.com`, path `api/upload`.
   - Policy: action **Bypass**, Include **Everyone**. (The upload address checks the archive key itself.)

### 3. Give the editor's GitHub App a key

1. On GitHub, go to **Settings** > **Developer settings** > **GitHub Apps** > `cattellcom-editor`.
2. Note the **App ID**.
3. Under **Permissions**, check **Contents** is **Read and write**.
4. Under **Private keys**, choose **Generate a private key**. A `.pem` file downloads.
5. Go to **Install App** (or your account's **Settings** > **Applications**), open the app's settings on `jacattell/cattell.com`, and note the number at the end of the page address. That is the **installation ID**.
6. The app's **Callback URL** is no longer used. You can remove it.

### 4. Make the admin Worker (admin.cattell.com)

1. In Cloudflare, **Workers & Pages** > **Create** > **Import a repository**, `jacattell/cattell.com` again.
2. **Project name** `cattell-admin`, **Root directory** `workers/admin`, deploy command `npx wrangler deploy`.
3. In **Settings** > **Variables and Secrets**, add these as **Text**:
   - `ADMIN_EMAILS`: your email address (the one Access lets in)
   - `ACCESS_TEAM`: your team's address, for example `cattell.cloudflareaccess.com`
   - `ACCESS_AUD`: the AUD tag from step 2
   - `GITHUB_APP_ID` and `GITHUB_APP_INSTALLATION_ID`: from step 3
4. And these as **Secrets**:
   - `GITHUB_APP_PRIVATE_KEY`: the whole text of the `.pem` file. Then delete the file.
   - `ARCHIVE_KEY`: copy it from the old Pages project
5. Open https://admin.cattell.com. You should be asked to sign in, then see your week notes.

### 5. Change the website's build settings, then merge

1. In the Pages project (`cattell-com`), go to **Settings** > **Build** and set **Build command** to `npm run build`. The output directory (`public`) is set by `wrangler.toml`, so the dashboard won't let you change it.
2. In **Settings** > **Variables and Secrets**, add as **Text**:
   - `HUGO_VERSION`: `0.170.1` (the version in `.hugo-version`)
   - `NODE_VERSION`: `22`
   - `HUGO_PARAMS_TURNSTILESITEKEY`: the Turnstile site key (it is public)
3. Merge the pull request. The site rebuilds in a couple of minutes.
4. Check the home page, a week note, the archive search, the contact form and Ask my AI.

### 6. Tidy up

1. For both Workers (`cattell-public` and `cattell-admin`), go to **Settings** > **Build** > **Branch control** and set the production branch back to `main`.
2. In the Pages project's **Settings** > **Variables and Secrets**, delete what it no longer uses: `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FORM_TO`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `ARCHIVE_KEY`. The `CHAT_LOGS` and `SESSIONS` bindings go automatically, because `wrangler.toml` no longer lists them.
3. In Cloudflare, **Security** > **WAF** > **Rate limiting rules**: change "Chat and forms" to match hostname `api.cattell.com` (paths `/chat` and `/form`).
4. In Turnstile, check the widget's hostnames include `www.cattell.com`.
5. In each Claude Code cloud environment, change the archive network secret's allowed website from `www.cattell.com` to `admin.cattell.com`.

## Social media archive

`/archive/` is a searchable archive of posts from Bluesky, LinkedIn, Mastodon and X (Twitter). Posts shared on more than one platform within 20 minutes, with mostly the same words, are shown once with a link to each platform.

| What | Where |
| --- | --- |
| Saved posts, one file per platform | `archive-data/` |
| Saved copies of images | `static/assets/archive/`, listed in `archive-data/media.json` |
| Scripts that download posts and copy images | `scripts/archive/` |
| How cross-posts are matched | `scripts/lib/archive.js` |
| Turning posts into page data, before Hugo runs | `scripts/prepare.mjs` |
| Pages | `content/archive/_content.gotmpl`, `layouts/archive/`, `layouts/_partials/archive-post.html` |
| Search | `assets/js/archive.js` |

Images are copied into the site, so the archive does not depend on Bluesky or Mastodon keeping them, and pages load nothing from other websites. Pictures without a saved copy are shown as a link instead. Each is saved once, as a web-sized picture and a small preview, with hidden data such as location removed. YouTube video thumbnails are copied too; a video that has been deleted or made private gets no preview. Videos are not copied: they link to the platform they were posted on.

Copying images needs one package (`sharp`), used only on your computer, never to build the website. Install it once:

```bash
npm install --prefix scripts
```

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
npm --prefix scripts run fetch-media
```

Retweets are left out; your own tweets, threads and replies are kept. The archive has no image descriptions. Images X no longer has are shown as "Image: no longer available", with a link to the tweet.

Because there are so many posts:

- year pages show 200 posts each, with links to newer and older pages
- the search page only downloads the posts once someone starts to search
- the chat leaves out posts that are only on X, so its input stays under 100,000 tokens

### LinkedIn

LinkedIn has no way to download posts except its data export (LinkedIn: **Settings** > **Data privacy** > **Get a copy of your data** > the larger archive). Only `Shares.csv` (posts) and `Rich_Media.csv` (their photos) are used; the rest of the export, such as messages and connections, is never read. Keep the export out of this repo.

```bash
node scripts/archive/import-linkedin.js path/to/Shares.csv path/to/Rich_Media.csv
```

```bash
npm --prefix scripts run fetch-media
```

Run the second straight after the first: the photo links in the export stop working after about a week.

The export doesn't say who could see each post, so the import opens each one on LinkedIn without signing in. Posts that ask you to sign in (connections-only posts, group posts and some very old posts) are left out. Posts already saved are not checked again. lnkd.in short links are replaced with where they go. LinkedIn videos are not copied.

## Claude sessions archive

`https://admin.cattell.com/sessions/` is a private, searchable archive of James's prompts and Claude's answers, with Claude's thinking, tool calls and tool results, from Claude Code and from Claude chats. Only you can read it: it is behind Cloudflare Access, like the rest of the admin tools. It is not part of the public site and is not in this repository. The upload address is the one part of admin.cattell.com that Cloudflare Access lets through, so scripts can reach it. It needs the long archive key, and it can only add sessions, never read them.

- Thinking, tool calls and tool results are shown folded up, and the search can leave them out. Claude Code saves only a short summary of the thinking, and sometimes none.
- Tool results hold file contents and command output, so they can hold secrets. The scripts that send sessions replace anything that looks like a key, token or password with `[secret removed]` before it leaves the computer (`redact` in `lib/session-formats.js`). This is a safety net, not a guarantee, so still check a session before making it public.
- Sessions sent before this was added still hold what they held. Send them again to replace them.
- The scripts only send the archive key to an `https://` address. `ARCHIVE_URL` can change the address, for testing.
- One message can hold up to 200,000 characters. Anything longer is cut short, with a note.
- Every session has a `public` setting, which is off. Nothing reads it yet. It is there so single sessions could be published later.
- A session can be deleted from its page in the archive.

| What | Where |
| --- | --- |
| Saving, searching and reading | `workers/admin/src/sessions.js` |
| Reading Claude Code transcripts and claude.ai exports | `lib/session-formats.js` |
| Upload address | `https://admin.cattell.com/api/upload` |
| Scripts that send sessions | `scripts/sessions/` |
| Page | `workers/admin/public/sessions/`, `workers/admin/public/sessions.js` |
| Automatic sending from Claude Code | `.claude/settings.json` |

### Set it up (once)

The database (`cattell-sessions`) already exists. The admin Worker needs the `ARCHIVE_KEY` secret (see "Switching over"). On each computer that will send sessions, save the same key in the file `~/.config/cattell-archive/key`. Never put the key in this repository.

### Send sessions

Every script replaces the archive's copy of a session it sends again, so running one twice is safe.

Claude Code sessions saved on this computer (Claude Code keeps them for 30 days):

```
node scripts/sessions/upload-claude-code.js --all
```

Claude chats: in Claude, go to **Settings** > **Privacy** and export your data. Unzip the file you are emailed, then:

```
node scripts/sessions/import-claude-export.js path/to/unzipped-folder
```

The export arrives as several zip files. Only `conversations-000.zip` is needed: unzip it and give the script that folder. Chats cannot be sent automatically, so repeat the export when you want the archive brought up to date.

The export's `claude_code_cloud` file only lists scheduled tasks. It does not hold the cloud Claude Code sessions themselves.

### Send Claude Code sessions automatically

`.claude/settings.json` runs the upload script after each of Claude's replies, and when a session ends. Each time, it sends only what is new. It does nothing unless one of these is true:

- **On a computer:** the key is saved in `~/.config/cattell-archive/key`.
- **In a cloud session:** the environment has `CATTELL_ARCHIVE=1`. Nobody else's environment has this, so nobody else's sessions are sent.

Cloud sessions only run hooks saved in the session's repository, and only when the session has one repository. So each repository needs the hook:

- **This repository:** already set up.
- **Your other repositories:** copy `scripts/sessions/for-other-repos/cattell-archive.sh` to `.claude/hooks/cattell-archive.sh` there, and `scripts/sessions/for-other-repos/settings.json` to `.claude/settings.json` (or merge its `hooks` into the existing file). The script fetches the upload script from this public repository.
- **Repositories that aren't yours,** such as UKGovCamp's: don't add it. Sessions there aren't sent.

To set up a cloud environment (once for each environment, at [claude.ai/code](https://claude.ai/code)):

1. Open the environment for editing.
2. Under **Environment variables**, add `CATTELL_ARCHIVE=1`.
3. Under **Network secrets**, choose **Add secret**. Name: `cattell.com archive`. Allowed websites: `admin.cattell.com`. Custom headers: `Authorization`, prefix `Bearer`, and the archive key as the value. The key is added to requests on their way out, so it never enters the session.
4. Save. Sessions started after this are sent.

To do the same for every project on a computer, add this to `~/.claude/settings.json` there, with the real path to this repository:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node /path/to/cattell.com/scripts/sessions/upload-claude-code.js --hook", "async": true }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "node /path/to/cattell.com/scripts/sessions/upload-claude-code.js --hook", "timeout": 30 }] }
    ]
  }
}
```

Past cloud sessions aren't in the claude.ai data export. `claude --teleport` shows them on a computer, but only saves them there once a new message is sent, which uses some of your plan's usage.

## Old addresses

Addresses from the Google Sites version, such as `/week-notes/2026-week-14`, redirect to the new ones (`/week-notes/2026/14/`). So do the old editor pages (`/edit/...` goes to admin.cattell.com) and the old GOV.UK version (`/govuk/...` goes to the home page). The rules are made at build time by `layouts/home.redirects`.

## Licence

See [LICENSE](LICENSE).
