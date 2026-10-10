#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
rm -rf "$DIST"
mkdir -p "$DIST/data"
cp "$ROOT/index.html" "$ROOT/app.js" "$ROOT/styles.css" "$DIST/"
cp "$ROOT/data/clinics.json" "$DIST/data/clinics.json"
cat > "$DIST/_redirects" <<'REDIRECTS'
# Canonical hostname
# Keep the working apex domain as the only public host.
https://www.childandkid.com/* https://childandkid.com/:splat 301!
http://www.childandkid.com/* https://childandkid.com/:splat 301!
REDIRECTS
# Build dist/config.js from the SOURCE config.js so the accuracy date (and any
# future label changes) remain the single source of truth. A stale hard-coded
# "22 Jun 2026" label used to live in this heredoc and silently overrode the
# committed config.js on every deploy. We now copy the source file verbatim and
# substitute ONLY the Google Maps API key from the build environment
# (Cloudfle Pages GOOGLE_MAPS_API_KEY env var), leaving the sourceLabel untouched.
cp "$ROOT/config.js" "$DIST/config.js"
if [[ -n "${GOOGLE_MAPS_API_KEY:-}" ]]; then
  # Inject the live, domain-restricted browser key for production. The source
  # config.js ships a placeholder key ("REPLACE_WITH_GOOGLE_MAPS_API_KEY");
  # replace it when a real key is provided. Google Maps API keys are
  # [A-Za-z0-9_-], so they never contain '/', making '/' a safe sed delimiter.
  sed -i "s/REPLACE_WITH_GOOGLE_MAPS_API_KEY/${GOOGLE_MAPS_API_KEY}/g" "$DIST/config.js"
fi
