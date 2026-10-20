// GET /api/clinics — query the PaedsENGAGE clinic dataset.
// Params: area, q, day (Mon..Sun or full name), time (HH:MM), open_now=1,
//         limit (default 50, max 556), offset. Public, CORS-open.
import { loadClinics, filterClinics, publicClinic, sgNow, normaliseDay, jsonResponse, DATA_AS_OF, DATA_SOURCE } from "../_lib/clinics.js";

export async function onRequestGet(context) {
  try {
    const clinics = await loadClinics(context);
    const p = new URL(context.request.url).searchParams;
    let day = normaliseDay(p.get("day"));
    let minutes = null;
    const time = p.get("time");
    if (time && /^\d{1,2}:\d{2}$/.test(time)) {
      const [h, m] = time.split(":").map(Number);
      minutes = h * 60 + m;
      if (!day) day = sgNow().day;
    }
    let nowCtx = null;
    if (p.get("open_now") === "1") {
      nowCtx = sgNow();
      day = nowCtx.day;
      minutes = nowCtx.minutes;
    }
    const limit = Math.min(Math.max(parseInt(p.get("limit") || "50", 10) || 50, 1), 556);
    const offset = Math.max(parseInt(p.get("offset") || "0", 10) || 0, 0);
    const { total, results } = filterClinics(clinics, {
      area: p.get("area"), q: p.get("q"), day, minutes, limit, offset,
    });
    return jsonResponse({
      data_as_of: DATA_AS_OF, source: DATA_SOURCE, total,
      count: results.length, offset,
      results: results.map((c) => publicClinic(c, nowCtx)),
    });
  } catch (err) {
    return jsonResponse({ error: String(err && err.message || err) }, 500);
  }
}
