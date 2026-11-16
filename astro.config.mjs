import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Marketing pages are prerendered; /book, booking APIs and /admin opt out with `export const prerender = false`.
export default defineConfig({
  site: 'https://www.moonandsilks.com',
  trailingSlash: 'never',
  build: { format: 'directory' },
  adapter: vercel({ maxDuration: 30 }),
});
