# Deployment guide

The site is plain HTML and CSS in `_site/`, served from a **private S3 bucket behind CloudFront** on CloudFront's **flat-rate Free plan ($0/month, no overage charges)**. GitHub Actions builds every push and pull request, and deploys every push to `main`.

Everything AWS-side is one CloudFormation stack in `infra/site.yml`: the bucket, CloudFront, the security headers, the URL rewrite, the deploy role GitHub uses, and a budget alarm that emails the moment the account spends anything.

---

## 1. Before you start

- **Node 24 LTS** (`.nvmrc` pins it), **Git**, the **GitHub CLI** (`gh`) and the **AWS CLI** v2.32 or later (for `aws login`)
- An **AWS account on the Paid plan.** New accounts on the Free plan close after 6 months or when credits run out, which would take the site down. Upgrading keeps the always-free allowances.
- **MFA on the root user.**

```bash
npm ci && npm audit && npm run build   # expect 0 vulnerabilities, 7 pages and feed.xml
aws login --region eu-west-2           # opens the browser, then caches short-lived credentials
```

## 2. Create the stack (once)

```bash
aws cloudformation deploy \
  --region eu-west-2 \
  --stack-name frank-site \
  --template-file infra/site.yml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides BudgetEmail=you@example.com

aws cloudformation describe-stacks --region eu-west-2 --stack-name frank-site \
  --query "Stacks[0].Outputs" --output table
```

If the account already has a GitHub OIDC provider, add `CreateGitHubOidcProvider=false`. AWS emails the budget address once to confirm the subscription.

## 3. Switch the distribution to the Free plan (console, once)

CloudFront > Distributions > the new distribution > **Billing** > **Switch to a plan** > choose **Free**. Without this it bills pay-as-you-go, which is still covered by the always-free tier (1 TB and 10M requests a month) but has no hard cap.

The Free option is greyed out while the AWS account itself is on the Free account plan: flat-rate plans need a Paid account. Flat-rate plans also reject any price class other than `PriceClass_All`, which is why the template uses it.

## 4. Point GitHub at the stack

No AWS keys are stored in GitHub. The workflow swaps a GitHub OIDC token for short-lived credentials on a role that only `main` of this repo can assume, and that can only write to this bucket and clear this distribution's cache.

```bash
out() { aws cloudformation describe-stacks --region eu-west-2 --stack-name frank-site \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }

gh variable set AWS_REGION --body eu-west-2
gh variable set AWS_DEPLOY_ROLE_ARN --body "$(out DeployRoleArn)"
gh variable set S3_BUCKET --body "$(out BucketName)"
gh variable set CLOUDFRONT_DISTRIBUTION_ID --body "$(out DistributionId)"
```

Then set `url` in `src/_data/site.json` to the `SiteUrl` output (it drives canonical links and the feed) and push.

## 5. What each push does

1. `npm ci`, then `npm audit --audit-level=low`, which **fails the build on any known vulnerability**
2. `npm run build`
3. On `main` only: `aws s3 sync --delete` (HTML revalidates on every visit, CSS and images cache for an hour), then a `/*` CloudFront invalidation

## 6. Custom domain (optional)

The site is served on `refreshinglyfrank.co.uk` (DNS at Namecheap); `www.` 301-redirects to it via the CloudFront Function.

1. Request a certificate in ACM in **us-east-1** (CloudFront only reads certificates from there) for the apex and `www.`, with DNS validation. Add its two validation CNAMEs at the DNS host and **leave them there**, ACM needs them to auto-renew.
2. Once it is `ISSUED`, redeploy the stack with `--parameter-overrides DomainName=example.co.uk CertificateArn=arn:aws:acm:us-east-1:…` (other parameters keep their previous values).
3. Point the domain at the `cloudfront.net` address: CNAME for `www`, and ALIAS (Namecheap's name for a CNAME-like record at the apex) for `@`.
4. Set `url` in `site.json` to the domain and push.

ACM certificates and custom domains cost nothing on CloudFront.

## 7. Check it's secure

- **securityheaders.com** should score A or A+. Headers come from the `SecurityHeaders` policy in `infra/site.yml`.
- **pagespeed.web.dev** should be green across the board.

The Content Security Policy blocks all scripts (`script-src 'none'`) and only lets the contact form post to Web3Forms. If you ever add JavaScript, loosen that deliberately in the template and redeploy the stack.

## Changing the infrastructure

Edit `infra/site.yml` and re-run the `aws cloudformation deploy` command from step 2. To remove everything: empty the bucket (`aws s3 rm s3://BUCKET --recursive`), then `aws cloudformation delete-stack --stack-name frank-site --region eu-west-2`.

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
| actions/upload-artifact, download-artifact | v7, v8 |
| aws-actions/configure-aws-credentials | v6 |

Versions are pinned exactly in `package.json` and locked in `package-lock.json`. Always install with `npm ci`, never `npm install`, so you get what was tested.

### Dependabot

`.github/dependabot.yml` checks weekly for new versions of npm packages and GitHub Actions and opens a PR for each. The build and audit run on each PR (no preview deployment on AWS). If the checks are green, merge it.

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

- **Pin Actions to commit SHAs** instead of tags, so a compromised tag can't change what runs. Dependabot updates SHA pins too.
- **Self-host the fonts.** Outfit loads from Google Fonts, so visitors' IP addresses go to Google. Install `@fontsource/outfit`, copy the `.woff2` files into `src/assets/fonts/`, add `@font-face` rules to `main.css`, remove the Google links from `base.njk`, and tighten the CSP to `font-src 'self'`.
- **Branch protection** on `main`, requiring the build job to pass before merging.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Build fails at `npm audit` | A new advisory has been published. Run `npm audit` locally, update the affected package (or wait for Dependabot), then push. Don't remove the audit step. |
| `Could not assume role with OIDC` | A repo variable is missing or wrong, or the push wasn't to `main`. Check `gh variable list` against the stack outputs. |
| Old content still showing | Check the invalidation step ran. HTML is never cached by browsers, but CSS can be for up to an hour. |
| Every page is the 404 page | The bucket is empty or the sync went to the wrong bucket. `aws s3 ls s3://BUCKET` |
| Budget alert email arrived | Something billed. Check Billing > Bills and confirm the distribution is on the Free pricing plan. |
| New Tailwind class has no effect | Tailwind only generates classes it finds in files under `src/`. Check for typos, then rebuild. |
| `Port 8080 is busy` locally | `PORT=8081 npm run dev` |
| Fonts look wrong locally | Probably offline. They load from Google Fonts and fall back to system fonts without a connection. |
