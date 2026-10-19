# edit_my-website

The private editor for [youhannad.com](https://youhannad.com), running at **edit.youhannad.com**.
Only the owner can open it (Cloudflare Access + a second check in the Worker).

- **Text:** every piece of text on the home and photography pages, grouped by section.
  `*italic*`, `**bold**`, `==accent highlight==`, Enter for a line break. Any text can get
  its own colour: you pick the dark-mode colour and the light-mode one is generated.
- **Photos:** add photos (resized to WebP in the browser, location data stripped, camera
  settings read automatically), drag to reorder, set title / location / category / camera
  settings, feature on the home page, manage gallery categories, and swap the photography
  header, the print image and the About portrait.
- **Colours:** the site's palette. Pick dark-mode colours; light mode is derived (same hue,
  contrast checked) and shown next to each.

Edits show live in the preview. **Save draft** stores them privately; the preview then shows
the saved draft. **Release** publishes the draft to youhannad.com (live about a minute later).

## How it works

```
browser (public/)  ──►  Worker (src/)  ──►  GitHub API: ydimian/my-portfolio-yd
                        checks sign-in          draft branch  ◄── Save draft
                        serves /preview/        main branch   ◄── Release ──► Cloudflare redeploys youhannad.com
```

- The site marks editable elements in its HTML: `data-edit="key"` (text, lists, `<title>`),
  `data-edit-img="slot"` (pictures), `data-edit-img-link` / `data-edit-img-hex` (the link and
  colour tag that go with a picture).
- Saving rewrites only the edited parts of the HTML at exact source offsets
  (`src/html-scan.js`, `src/html-regions.js`), so everything else stays byte-for-byte the same.
- Files it writes in the site repo: `index.html`, `photography.html`,
  `assets/js/data/photos.data.js` (the photo library), `assets/css/theme.css` (colours) and
  `assets/photos/<id>.webp` + `<id>-900.webp`.
- **Save draft** = one commit on `draft`. **Release** = fast-forward `main` to `draft` (or merge if
  `main` moved). **Discard** = reset `draft` to `main`.
- The preview at `/preview/<commit>/…` serves the draft straight from GitHub, cached by commit.

> After a release, `main` on GitHub has moved: run `git pull` in your local copy of the site
> before editing it by hand.

## Security

- Cloudflare Access only lets the owner's email through. The Worker also verifies Access's
  signed token itself (signature, team, audience tag, expiry, email == `OWNER_EMAIL`), and
  stays locked if Access isn't configured.
- The GitHub token is a Worker secret, never sent to the browser. Use a fine-grained token
  limited to `my-portfolio-yd` with **Contents: read and write** only.
- No `workers.dev` or preview URLs: the editor is only reachable at edit.youhannad.com.
- Write requests need a custom header and a JSON body, so other sites can't trigger them.

## One-time setup

1. **GitHub token:** github.com → Settings → Developer settings → Fine-grained tokens →
   *Generate new token*. Repository access: only `ydimian/my-portfolio-yd`. Permissions:
   Contents → *Read and write*.
2. **Worker:** Cloudflare → Workers & Pages → Create → *Import a repository* →
   `ydimian/edit_my-website`. Name it `edit-youhannad`; deploy command `npx wrangler deploy`.
   The `edit.youhannad.com` domain is created on deploy.
3. **Secret:** the Worker → Settings → Variables and Secrets → Add → type *Secret*,
   name `GITHUB_TOKEN`, paste the token.
4. **Access:** Cloudflare Zero Trust → Access → Applications → Add → *Self-hosted*.
   Hostname `edit.youhannad.com`; policy *Allow*, include *Emails* = your email.
5. **Unlock:** put the team domain (`<team>.cloudflareaccess.com`) and the application's
   *Audience (AUD) tag* into `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` in `wrangler.jsonc`, and make
   sure `OWNER_EMAIL` is the email you sign in with. Push; it redeploys unlocked.
6. **Site Worker:** in the `my-portfolio-yd` Worker → Settings → Build → Branch control, turn off
   builds for non-production branches, so saved drafts aren't built into public preview URLs.

## Local development

```bash
npm install
npm run mock-github        # fake GitHub API on :8788, seeded from the site folder
npm run dev                # editor on http://localhost:8790
npm test
```

`.dev.vars` (not committed):

```
DEV_AUTH_BYPASS=1
GITHUB_TOKEN=local-dev
GITHUB_API=http://127.0.0.1:8788
```

`DEV_AUTH_BYPASS` only works on `localhost`. The mock and the tests read the site from the
folder this project sits in, or from `SITE_DIR` if set.

## Notes

- Cloudflare's free plan allows about 10 ms of CPU per request, so the HTML scanner is
  purpose-built (about 5 ms for both pages, checked against a full parser in
  `test/scan.test.mjs`), and new photos are uploaded one file per request before a save.
- Gallery changes (new photos, order, details) show in the preview after you save; text,
  colours and page images show live.
- On a phone, drag-to-reorder isn't available: use *Position* in a photo's details instead.
