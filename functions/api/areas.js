// GET /api/areas — all areas with clinic counts and a centroid (mean of the
// geocoded clinics in the area), so agents and maps can place each area.
import { loadClinics, jsonResponse, DATA_AS_OF, DATA_SOURCE } from "../_lib/clinics.js";

export async function onRequestGet(context) {
  try {
    const clinics = await loadClinics(context);
    const byArea = new Map();
    for (const c of clinics) {
      if (!byArea.has(c.location)) byArea.set(c.location, []);
      byArea.get(c.location).push(c);
    }
    const areas = [...byArea.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, cs]) => {
      const geo = cs.filter((c) => c.latitude !== null && c.latitude !== undefined);
      const centroid = geo.length
        ? {
            latitude: +(geo.reduce((s, c) => s + c.latitude, 0) / geo.length).toFixed(6),
            longitude: +(geo.reduce((s, c) => s + c.longitude, 0) / geo.length).toFixed(6),
          }
        : null;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return { name, slug, clinic_count: cs.length, centroid, page_url: `https://childandkid.com/areas/${slug}/` };
    });
    return jsonResponse({ data_as_of: DATA_AS_OF, source: DATA_SOURCE, total_areas: areas.length, areas });
  } catch (err) {
    return jsonResponse({ error: String(err && err.message || err) }, 500);
  }
}
