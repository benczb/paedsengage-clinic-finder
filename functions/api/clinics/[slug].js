// GET /api/clinics/<slug> — one clinic by its stable slug/id.
import { loadClinics, publicClinic, sgNow, jsonResponse, DATA_AS_OF, DATA_SOURCE } from "../../_lib/clinics.js";

export async function onRequestGet(context) {
  try {
    const clinics = await loadClinics(context);
    const slug = context.params.slug;
    const clinic = clinics.find((c) => c.slug === slug || c.id === slug);
    if (!clinic) return jsonResponse({ error: `No clinic with slug '${slug}'` }, 404);
    return jsonResponse({ data_as_of: DATA_AS_OF, source: DATA_SOURCE, result: publicClinic(clinic, sgNow()) });
  } catch (err) {
    return jsonResponse({ error: String(err && err.message || err) }, 500);
  }
}
