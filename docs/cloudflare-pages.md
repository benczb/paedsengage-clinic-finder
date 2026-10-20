# Cloudflare Pages Deployment

This repo follows the original June 6 Clawver PaedsEngage build shape: the public site is the repository root.

## Recommended settings

- Framework preset: None
- Build command: leave blank
- Build output directory: `/` or `.` (repository root)
- Production branch: `main`

## Compatibility option

If Cloudflare Pages requires a build command/output pair, use:

- Build command: `bash scripts/build.sh`
- Build output directory: `dist`

The wrapper copies the root static files into `dist/`.

## Required/optional environment variable

```text
GOOGLE_MAPS_API_KEY=your-restricted-browser-key
```

If the key is not configured, the clinic search and results still load. Only the map panel is disabled.

## Custom domain

Apex `childandkid.com` should be attached to this Pages project. If `www.childandkid.com` is needed, either attach it as an additional custom domain or redirect it to the apex.

## Bot pack environment variables (optional)

The `/api/chat` assistant works without any configuration (deterministic
fallback answers). To enable LLM-phrased answers via Nous Portal's free tier,
set these in the Pages project's production environment:

```text
NOUS_PORTAL_API_KEY=<key from portal.nousresearch.com API Keys page>
NOUS_MODEL=stepfun/step-3.7-flash   # optional; free-model slugs rotate —
                                    # copy the exact slug from
                                    # https://portal.nousresearch.com/info
```

The key is only read server-side by the Pages Function; never put it in
`config.js` or any committed file.
