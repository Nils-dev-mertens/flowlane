# flowlane — landing site

Static landing page for the `flowlane` CLI, built with [Astro](https://astro.build) + Tailwind CSS.
The design follows the "Structured Industrialism" system in `.agents/site/DESIGN.md` (brutalist,
zero border-radius, Space Grotesk / Inter, signal-red accents).

## Why a separate `site/` folder

The repo root is the published npm package. `package.json` ships only `dist/`, `README.md`, and
`LICENSE.md` via the `files` allowlist, so this folder never leaks into the npm artifact.

## Run locally

```bash
cd site
npm install
npm run dev        # http://localhost:4321
```

## Build

```bash
npm run build      # static output in site/dist/
npm run preview    # serve the built site locally
```

CSS is inlined into the page (`build.inlineStylesheets: 'always'`), so the output works from any
base path — or even as a single file.

## Deploy to GitHub Pages

`astro.config.mjs` ships with `site`/`base` commented out. For a GitHub Pages **project site**
(`https://<user>.github.io/flowlane/`), uncomment:

```js
site: 'https://nils-dev-mertens.github.io/flowlane/',
base: '/flowlane/',
```

For a custom domain or hosting at the repo root, leave them commented out. Then enable
**Settings → Pages → Source: GitHub Actions** and add a workflow that builds `site/` and deploys
with `actions/deploy-pages`.

## Content accuracy

Copy reflects the real CLI: commands are `flowlane …`, providers are Azure DevOps / GitHub / Jira,
and the version shown in the footer/CTA is read from the root `package.json`, so it stays in sync
with releases.
