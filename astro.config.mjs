// @ts-check
import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';

// Pagine bozza/duplicate/riservate da escludere dalla sitemap (sono anche noindex).
const EXCLUDED = /\/(index2|index3|archive1|pacpunk|accept-bacheka|stats)\/?$/;

// https://astro.build/config
export default defineConfig({
  site: 'https://www.strummolo.com',
  integrations: [
    sitemap({
      filter: (page) => !EXCLUDED.test(page),
    }),
  ],
});