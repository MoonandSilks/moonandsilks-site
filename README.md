# Moon and Silks Circus Co — website

Static marketing site for moonandsilks.com. Astro, four pages (`/`, `/book`, `/about`, `/contact`), no backend.

## Run it

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # outputs dist/
npm run preview  # serve the build
```

## Fill in the placeholders

Placeholders show as a dashed gold box. Find them all with a search for `placeholder`.

- **Business facts** (email, venue/suburb, social links): `src/site.ts`
- **Home hero line and class cards:** `src/pages/index.astro`
- **Class times, ages, prices:** `src/pages/book.astro`
- **Instructor name, bio, photo:** `src/pages/about.astro`. Put the photo in `public/` and swap the commented `<img>` in.
- **Logo:** if the artwork changes, replace `assets/Aerial-Silks-Logo.jpg` and run `npm run logo`. This rebuilds the transparent logo, the icons and the share image.

## Settings (environment variables)

Copy `.env.example` to `.env` for local use. On Vercel, add the variables under **Project → Settings → Environment Variables**, then redeploy.

| Variable | What it does |
|---|---|
| `PUBLIC_BOOKING_EMBED_URL` | Booking tool embed link. When it's empty, `/book` shows a placeholder. |
| `PUBLIC_FORM_ENDPOINT` | Form service URL for `/contact` (e.g. `https://formspree.io/f/xxxx`). When it's empty, the form says it isn't connected yet and offers an email link. |

**Booking tools that embed easily:** Cal.com or TidyCal (free), or a class tool such as Momence, Punchpass or Fresha. Paste the tool's embed or booking-page URL into the variable. To use a different kind of embed, edit `src/components/BookingEmbed.astro`.

**Contact form:** Formspree, Tally or Getform. Create a form and paste its endpoint URL.

## Deploy (Vercel Hobby + Cloudflare DNS)

1. Log in to Vercel as **MoonandSilks**, then **Add New Project** → import **MoonandSilks/moonandsilks-site**.
2. Vercel should pick the Astro preset. Stay on the Hobby plan and deploy with the default settings.
3. Once the preview looks right, go to **Settings → Domains** and add `moonandsilks.com` and `www.moonandsilks.com`. Make `moonandsilks.com` the main domain and redirect `www` to it, which matches the site's canonical URLs.
4. Copy the DNS records Vercel shows, and check them against the dashboard before using them. They are usually:
   - `A` record for `@` → `76.76.21.21`
   - `CNAME` record for `www` → `cname.vercel-dns.com`
5. In Cloudflare, go to **DNS** for moonandsilks.com and add those records. Set both to **DNS only (grey cloud)**, because the orange-cloud proxy blocks Vercel's certificate. Leave the nameservers alone.
6. Wait for the certificate to appear, then check that `https://moonandsilks.com` loads with a padlock and that `https://www.moonandsilks.com` redirects to it.
