# Deployment guide

This site deploys to **Azure Static Web Apps (Free tier, £0/month)** via GitHub Actions. Every push to `main` goes live, and every pull request gets its own preview URL.

Why Azure Static Web Apps: free hosting with a global CDN, free managed TLS on custom domains, PR preview environments, and security headers controlled from a file in the repo.

---

## 1. Before you start

You need:

- **Node 24 LTS** (`nvm install 24` or from nodejs.org). The repo's `.nvmrc` pins this.
- **Git** and a **GitHub account**
- An **Azure subscription** (a free account works)
- **Azure CLI** (`az`) and **GitHub CLI** (`gh`), both optional but they make steps 4 and 5 copy-and-paste

Check everything works locally first:

```bash
npm ci
npm audit          # expect: found 0 vulnerabilities
npm run build      # expect: _site/ folder with 7 pages and feed.xml
npm run dev        # browse http://localhost:8080
```

## 2. Personalise

Edit `src/_data/site.json`:

```json
{
  "name": "Frank",
  "url": "https://your-domain.co.uk",
  "email": "you@your-domain.co.uk",
  "linkedin": "https://www.linkedin.com/in/your-profile",
  "github": "https://github.com/your-username",
  "location": "Leeds"
}
```

`url` matters: it's used for canonical links and the RSS feed. Set it to the final address (your custom domain, or the `*.azurestaticapps.net` address from step 4 if you don't have one yet).

Then rewrite the two starter posts in `src/blog/posts/`.

## 3. Push to GitHub

```bash
git init
git add .
git commit -m "First commit"
gh repo create frank-site --private --source=. --push
```

(No `gh`? Create an empty repo on github.com, then `git remote add origin ...` and `git push -u origin main`.)

## 4. Create the Static Web App

The repo already contains its own workflow at `.github/workflows/azure-static-web-apps.yml`. So create the app **without** linking it to GitHub, otherwise Azure commits a second, generic workflow of its own.

```bash
az login

az group create --name rg-frank-site --location westeurope

az staticwebapp create \
  --name frank-site \
  --resource-group rg-frank-site \
  --location westeurope \
  --sku Free
```

Portal alternative: Create resource > Static Web App > Plan: Free > Deployment source: **Other**.

## 5. Give GitHub the deployment token

```bash
TOKEN=$(az staticwebapp secrets list \
  --name frank-site \
  --resource-group rg-frank-site \
  --query "properties.apiKey" -o tsv)

gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --body "$TOKEN"
```

Portal alternative: Static Web App > Overview > **Manage deployment token**, copy it, then GitHub repo > Settings > Secrets and variables > Actions > New secret named `AZURE_STATIC_WEB_APPS_API_TOKEN`.

Treat this token like a password. Anyone with it can overwrite the site. If it leaks, reset it from the same screen.

## 6. Deploy

```bash
git commit --allow-empty -m "Deploy" && git push
```

Watch it in the repo's **Actions** tab. The pipeline:

1. Checks out the code with Node 24
2. `npm ci` installs the exact locked versions
3. `npm audit --audit-level=low` **fails the build if any known vulnerability exists**
4. `npm run build` produces `_site/`
5. Uploads `_site/` to Azure

Find the live address:

```bash
az staticwebapp show --name frank-site --resource-group rg-frank-site \
  --query "defaultHostname" -o tsv
```

## 7. Custom domain (optional)

For `www.your-domain.co.uk`, add a DNS record at your registrar:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | www | *your-app*.azurestaticapps.net |

Then:

```bash
az staticwebapp hostname set \
  --name frank-site \
  --resource-group rg-frank-site \
  --hostname www.your-domain.co.uk
```

Azure issues and renews the TLS certificate for free. Apex domains (no `www`) need a TXT validation record instead; the portal's Custom domains blade walks you through it. Remember to update `url` in `site.json` and push.

## 8. Check it's secure

Once live, run the address through:

- **securityheaders.com**: should score A or A+. Headers come from `src/staticwebapp.config.json`.
- **pagespeed.web.dev**: should be green across the board. There's no JavaScript to slow it down.

The Content Security Policy blocks all scripts (`script-src 'none'`). If you ever add JavaScript, you'll need to loosen that deliberately. That's the point.

---

## Keeping dependencies current and safe

### Versions at time of build (5 October 2026)

| Package | Version |
| --- | --- |
| Node.js | 24 LTS |
| @11ty/eleventy | 3.1.6 |
| @11ty/eleventy-plugin-rss | 3.1.0 |
| tailwindcss / @tailwindcss/cli | 4.3.3 |
| actions/checkout, actions/setup-node | v7 |
| Azure/static-web-apps-deploy | v1 |

Versions are pinned exactly in `package.json` and locked in `package-lock.json`. Always install with `npm ci`, never `npm install`, so you get what was tested.

### Dependabot

`.github/dependabot.yml` checks weekly for new versions of npm packages and GitHub Actions and opens a PR for each. Each PR gets a preview deployment, and the audit gate runs on it. If the preview looks right and the checks are green, merge it.

### The overrides in package.json, and why they're there

The latest stable Eleventy (3.1.6) and Tailwind CLI (4.3.3) both pull in an old file-watching library chain that includes `braces`, which has a high-severity advisory (GHSA-vfj7-8cjw-p6xm) with **no patched version available**. So "just upgrade" isn't possible. Two overrides remove it:

```json
"overrides": {
  "@parcel/watcher": "2.6.0",
  "chokidar": "4.0.3"
}
```

- `@parcel/watcher` 2.6.0 is a newer version of Tailwind's own watcher that drops the vulnerable dependency. Straight swap.
- `chokidar` 4 removes it from Eleventy's tree, **but breaks Eleventy 3's `--serve` file watching** (it silently stops noticing changes). So `npm run dev` doesn't use `eleventy --serve`. It runs `scripts/dev.js`, a small dev server built only on Node's own libraries, which rebuilds on save and live-reloads the browser.

Realistically the advisory was low risk here (it only affects build tooling, never the deployed site, which is plain HTML and CSS), but the brief was no known vulnerabilities, and this gets `npm audit` to a clean zero without losing anything.

**When Eleventy 4 ships as stable**, it uses a newer watcher without `braces`. At that point: upgrade Eleventy, delete the `chokidar` override, run `npm audit`, and if it's clean you can switch `dev` back to `eleventy --serve` and delete `scripts/dev.js`. Same for the `@parcel/watcher` override once Tailwind ships a release depending on 2.6.0 or later.

### Optional hardening

- **Pin Actions to commit SHAs** instead of `@v7` tags, so a compromised tag can't change what runs. Dependabot updates SHA pins too.
- **Self-host the fonts.** Outfit currently loads from Google Fonts, which means visitors' IP addresses go to Google. To keep everything first-party, install `@fontsource/outfit`, copy the `.woff2` files into `src/assets/fonts/`, add `@font-face` rules to `main.css`, remove the Google links from `base.njk`, and tighten the CSP to `font-src 'self'`.
- **Branch protection** on `main` in GitHub, requiring the build job to pass before merging.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Build fails at `npm audit` | A new advisory has been published. Run `npm audit` locally, update the affected package (or wait for Dependabot), then push. Don't remove the audit step. |
| `deployment_token was not provided` | The `AZURE_STATIC_WEB_APPS_API_TOKEN` secret is missing or misspelt (step 5). |
| Site shows unstyled HTML | The CSS is built by Tailwind after Eleventy runs. Check the Actions log for a Tailwind error. |
| New Tailwind class has no effect | Tailwind only generates classes it finds in files under `src/`. Check for typos, then rebuild. |
| `Port 8080 is busy` locally | `PORT=8081 npm run dev` |
| Fonts look wrong locally | Probably offline. They load from Google Fonts and fall back to system fonts without a connection. |
| Custom domain stuck validating | DNS can take up to 48 hours. Check the CNAME with `dig www.your-domain.co.uk CNAME`. |

## Other hosts

The build output is plain files in `_site/`, so anything that serves static files works. Netlify, Cloudflare Pages and GitHub Pages all work with build command `npm run build` and output folder `_site`. Note that `staticwebapp.config.json` is Azure-specific: on another host you'll need to recreate the security headers and the 404 rule in that host's own format.
