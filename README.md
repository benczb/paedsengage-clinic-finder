# PaedsEngage Clinic Finder

A SEO-optimised **Astro** static site that helps parents in Singapore find a
participating **PaedsENGAGE** paediatric GP clinic (from the **KKH** and **NUH**
programme) near them, so they can avoid long hospital queues.

The site indexes every participating clinic with opening hours, doctors, phone
numbers and a direct **Google Maps** directions link.

Live site: **https://childandkid.com/**
Repo: **https://github.com/benczb/paedsengage-clinic-finder**

## Why the SEO rebuild

The previous version was a single-page HTML/JS app: Google only saw one title
and no individual clinic content. This Astro rebuild generates **590 static
pages**:

| Page type | Count | URL | SEO benefit |
|---|---|---|---|
| Homepage + finder | 1 | `/` | WebSite schema, search, FAQ |
| Neighbourhood listings | 51 | `/clinics/<area>/` | Local SEO "GP clinic in <area>" |
| Clinic detail pages | 535 | `/clinic/<area>-<name>/` | `MedicalClinic` schema + maps link |
| All-clinics index | 1 | `/clinics/` | Full crawlable list |
| About | 1 | `/about/` | Trust / E-E-A-T |

Every clinic page has a unique title, meta description, canonical URL,
`MedicalClinic` + `LocalBusiness` JSON-LD, opening hours, doctors, phone and a
"Open in Google Maps" button. A sitemap and robots.txt are generated so all
pages are discoverable.

## Tech stack

- **Astro 7** (static output) + `@astrojs/sitemap`
- Deployed to **Cloudflare Pages** (Git integration, prod branch `main`)

## Repository layout

```text
.
├── src/
│   ├── data/
│   │   ├── clinics.js      # data layer: slug helpers, location grouping
│   │   └── schema.js       # JSON-LD builders (WebSite, MedicalClinic, ItemList)
│   ├── layouts/Base.astro  # shared SEO head (title/desc/canonical/OG/JSON-LD)
│   ├── components/         # ClinicCard, etc.
│   ├── pages/              # index, /clinics/, /clinics/<area>/, /clinic/<name>/, about, 404
│   └── styles/global.css
├── data/
│   └── clinics.json        # SINGLE SOURCE OF TRUTH (PDF-parser output)
├── public/                 # robots.txt, _redirects, favicon, og-default
├── scripts/
│   ├── build.sh            # Cloudflare Pages build wrapper
│   ├── prepare-data.mjs    # copies data/clinics.json -> public/data/ (prebuild)
│   └── parse_paedsengage_pdf.py
├── astro.config.mjs
└── package.json
```

## Data source

Clinic data lives in `data/clinics.json`, derived from the official
Participating PaedsENGAGE Clinics PDF (accurate as of 05 Oct 2026). The
`prebuild` step copies it to `public/data/` so the client-side search can fetch
it at `/data/clinics.json` (keeps the JS bundle small).

Always verify clinic availability, doctor schedules and opening hours directly
with the clinic before visiting.

## Local development

```bash
npm install
npm run dev          # http://localhost:4321
```

## Production build

```bash
npm run build        # prebuild + astro build -> dist/
npm run preview      # serve the build locally
```

## Deploying to Cloudflare Pages

See `docs/cloudflare-pages.md` for the build settings and the
`PUBLIC_GOOGLE_MAPS_API_KEY` env var.