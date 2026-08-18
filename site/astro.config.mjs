// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// Deploying to GitHub Pages (project site) needs a base path:
//   site: 'https://nils-dev-mertens.github.io/flowlane/',
//   base: '/flowlane/',
// With a custom domain (or hosting at the repo root), remove both lines.
export default defineConfig({
  integrations: [
    tailwind({
      // global.css declares the @tailwind directives itself (base included),
      // so the integration must not inject a second copy.
      applyBaseStyles: false,
    }),
  ],
  build: {
    // Keep the page self-contained: CSS is inlined into the HTML so the
    // site works from any base path or even as a single file.
    inlineStylesheets: 'always',
  },
});
