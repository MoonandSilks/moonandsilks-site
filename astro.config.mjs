import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://moonandsilks.com',
  trailingSlash: 'never',
  build: { format: 'directory' },
});
