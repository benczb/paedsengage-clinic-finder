// GET /api — index of the PaedsENGAGE machine-readable surfaces, for agents.
import { jsonResponse, DATA_AS_OF, DATA_SOURCE } from "../_lib/clinics.js";

export function onRequestGet() {
  return jsonResponse({
    name: "PaedsENGAGE Clinic Finder API",
    description: "Participating PaedsENGAGE paediatric GP clinics in Singapore: search by area, name, doctor and opening hours. Free, no key, CORS-open.",
    data_as_of: DATA_AS_OF, source: DATA_SOURCE,
    endpoints: {
      clinics: "GET /api/clinics?area=&q=&day=&time=&open_now=&limit=&offset=",
      clinic_by_slug: "GET /api/clinics/<slug>",
      areas: "GET /api/areas",
      chat: "POST /api/chat {\"message\": \"Which clinics in Tampines are open on Sunday morning?\"}",
      openapi: "GET /api/openapi.json",
    },
    datasets: {
      json: "https://childandkid.com/data/clinics.json",
      geojson: "https://childandkid.com/data/clinics.geojson",
      csv: "https://childandkid.com/data/clinics.csv",
      llms_txt: "https://childandkid.com/llms.txt",
      llms_full: "https://childandkid.com/llms-full.txt",
    },
  });
}
