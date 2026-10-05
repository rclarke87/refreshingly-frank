# frank.

Frank by name. Frank by nature. Portfolio site for Frank, built with Eleventy 3 and Tailwind CSS 4. Zero client-side JavaScript, no cookies, no trackers.

## Quick start

```bash
nvm use            # Node 24 LTS, from .nvmrc
npm ci             # install exact locked versions
npm run dev        # http://localhost:8080 with live reload
npm run build      # production build into _site/
npm audit          # should say: found 0 vulnerabilities
```

## Where things live

| What | Where |
| --- | --- |
| Name, email, links, site URL | `src/_data/site.json` |
| Home page | `src/index.njk` |
| Blog listing | `src/blog/index.njk` |
| Blog posts (Markdown) | `src/blog/posts/YYYY-MM-DD-slug.md` |
| Contact page | `src/contact.njk` |
| Colours and fonts | `@theme` block in `src/assets/css/main.css` |
| The shirt print | `src/assets/img/print.svg` |
| Security headers, hosting | `infra/site.yml` (AWS CloudFormation) |

## Writing a post

Create `src/blog/posts/2026-10-12-my-post.md`:

```markdown
---
title: What I learned rebuilding a dead laptop
description: One line that appears on the blog listing.
date: 2026-10-12
---

Write it like you'd say it.
```

The two included posts are starters. Rewrite them in your own words before going live.

Deployment: see [DEPLOYMENT.md](DEPLOYMENT.md).
