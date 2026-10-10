// Client-visible configuration for the PaedsEngage Clinic Finder.
// The Google Maps browser API key is injected at build time from the
// PUBLIC_GOOGLE_MAPS_API_KEY environment variable (set in Cloudflare Pages).
// Build-time public env vars in Astro must be prefixed with PUBLIC_.

window.PAEDSENGAGE_CONFIG = {
  googleMapsApiKey: String(import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY || ''),
  sourceLabel:
    'Participating PaedsENGAGE Clinics PDF (accurate as of 05 Oct 2026)',
};