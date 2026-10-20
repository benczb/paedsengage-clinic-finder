// POST /api/chat — a parent-facing clinic assistant.
// Deterministic core: the question is parsed and the clinic dataset is
// filtered in code (area / day / time / keywords). The LLM only phrases the
// answer from the clinics the filter returned — it never searches or invents.
// LLM: Nous Portal (OpenAI-compatible), free-tier model. Configured via Pages
// environment variables:
//   NOUS_PORTAL_API_KEY  (required for LLM answers; without it, a
//                         deterministic fallback answer is returned)
//   NOUS_MODEL           (optional; tried first when set. Free-model slugs
//                         rotate and individual routes break, so a small
//                         built-in free-model chain follows; the first model
//                         that answers wins. Slugs verified against the
//                         public Nous catalog, GET /v1/models)
import {
  loadClinics, filterClinics, publicClinic, clinicOpenAt, todayHoursText,
  sgNow, normaliseDay, jsonResponse, DATA_AS_OF, DATA_SOURCE,
} from "../_lib/clinics.js";

const NOUS_URL = "https://inference-api.nousresearch.com/v1/chat/completions";
const FREE_MODELS = [
  "stepfun/step-3.7-flash:free",
  "meituan/longcat-2.0:free",
  "poolside/laguna-s-2.1:free",
  "upstage/solar-mini4:free",
];
const MAX_RESULTS = 8;

function parseQuestion(message, clinics) {
  const text = ` ${message.toLowerCase()} `;
  const areas = [...new Set(clinics.map((c) => c.location))].sort((a, b) => b.length - a.length);
  const area = areas.find((a) => new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(message)) || null;

  let day = null, dayLabel = null, minutes = null;
  const now = sgNow();
  if (/\b(open now|right now|currently open|still open)\b/.test(text)) {
    day = now.day; minutes = now.minutes; dayLabel = "now";
  } else if (text.includes(" tomorrow ")) {
    const t = sgNow(1); day = t.day; dayLabel = "tomorrow";
  } else if (text.includes(" today ") || text.includes(" tonight ")) {
    day = now.day; dayLabel = "today";
  }
  for (const [word, d] of Object.entries({ monday: "Mon", tuesday: "Tues", wednesday: "Wed", thursday: "Thurs", friday: "Fri", saturday: "Sat", sunday: "Sun" })) {
    if (text.includes(` ${word}`)) { day = d; dayLabel = word; break; }
  }
  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) || text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (timeMatch) {
    let h = Number(timeMatch[1]);
    const m = Number(timeMatch[2] || 0);
    if (timeMatch[3] === "pm" && h < 12) h += 12;
    if (timeMatch[3] === "am" && h === 12) h = 0;
    minutes = h * 60 + m;
    if (!day) { day = now.day; dayLabel = dayLabel || "today"; }
  } else if (day && minutes === null) {
    if (text.includes(" morning")) minutes = 10 * 60;
    else if (text.includes(" afternoon")) minutes = 15 * 60;
    else if (text.includes(" evening") || text.includes(" night")) minutes = 19 * 60 + 30;
    // a bare "tonight" still implies an evening time when day == today
    if (text.includes(" tonight") && day === now.day) minutes = 19 * 60 + 30;
  }
  if (day && minutes === null && dayLabel === "now") { /* handled above */ }

  // remaining keywords for name/doctor matching
  let q = message;
  if (area) q = q.replace(new RegExp(area, "ig"), " ");
  return { area, day, dayLabel, minutes, q };
}

function fallbackAnswer(results, ctx) {
  const when = ctx.minutes !== null && ctx.day
    ? ` open ${ctx.dayLabel || ctx.day} at ${String(Math.floor(ctx.minutes / 60)).padStart(2, "0")}:${String(ctx.minutes % 60).padStart(2, "0")}`
    : "";
  const where = ctx.area ? ` in ${ctx.area}` : " in Singapore";
  if (!results.length) {
    return `I couldn't find a PaedsENGAGE clinic${where}${when} in the current dataset (data as of ${DATA_AS_OF}). Try another area or time, and always call a clinic to confirm before visiting.`;
  }
  const lines = results.map((c) => {
    const day = ctx.day || sgNow().day;
    return `• ${c.clinic_name} (${c.location}) — ${c.address} — Tel ${c.contact_primary} — ${day} hours: ${todayHoursText(c, day)} — Map: ${c.google_maps_url}`;
  });
  if (ctx.relaxed) {
    return `No PaedsENGAGE clinic${where} is confirmed open at that exact time in the current dataset (data as of ${DATA_AS_OF}). Closest matches${where} — check their hours for the day:\n${lines.join("\n")}`;
  }
  return `Here ${results.length === 1 ? "is 1 PaedsENGAGE clinic" : `are ${results.length} PaedsENGAGE clinics`}${where}${when} (data as of ${DATA_AS_OF}; call to confirm hours before visiting):\n${lines.join("\n")}`;
}

async function nousAnswer(context, message, results, ctx) {
  const key = context.env.NOUS_PORTAL_API_KEY;
  if (!key) return { answer: null, error: "no_key_configured" };
  const day = ctx.day || sgNow().day;
  const contextLines = results.map((c) =>
    `- ${c.clinic_name} | Area: ${c.location} | Address: ${c.address} | Phone: ${c.contact_primary} | Doctors: ${(c.doctors || []).join(", ") || "n/a"} | ${day} hours: ${todayHoursText(c, day)} | All hours: ${(c.opening_hours_schema || []).join("; ")} | Map: ${c.google_maps_url} | Page: ${c.page_url}`
  ).join("\n");
  const system = [
    "You are the PaedsENGAGE clinic finder assistant on childandkid.com, helping Singapore parents find participating PaedsENGAGE paediatric GP clinics.",
    "Answer ONLY using the clinic data provided below. Never invent a clinic, phone number, address or opening hour.",
    "Be concise and warm. For each clinic you mention, include its name, address, phone number and the Google Maps link from the data.",
    `If no clinic in the data fits, say so plainly. End with a one-line note: data as of ${DATA_AS_OF}, call the clinic to confirm hours before visiting.`,
    "",
    "CLINIC DATA (already filtered to match the question):",
    contextLines || "(no clinics matched)",
    ctx.relaxed ? "\nNote: none of these are confirmed open at the exact requested time; present them as the closest matches in the area and give their hours for the requested day." : "",
  ].join("\n");
  const models = [...new Set([context.env.NOUS_MODEL, ...FREE_MODELS].filter(Boolean))];
  let lastError = "no_model_attempted";
  for (const model of models) {
    const attempt = await tryModel(key, model, system, message);
    if (attempt.answer) return { answer: attempt.answer, error: null, model };
    lastError = `${model} -> ${attempt.error}`;
  }
  return { answer: null, error: lastError };
}

async function tryModel(key, model, system, message) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(NOUS_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: "system", content: system },
          { role: "user", content: message },
        ],
      }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const raw = await res.text();
        detail = raw.replace(/\s+/g, " ").trim().slice(0, 200);
      } catch { /* keep status only */ }
      return { answer: null, error: `http_${res.status}${detail ? ": " + detail : ""}` };
    }
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return typeof text === "string" && text.trim()
      ? { answer: text.trim(), error: null }
      : { answer: null, error: "empty_model_response" };
  } catch (err) {
    return { answer: null, error: `request_failed: ${String(err && err.name || err).slice(0, 60)}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const message = String(body.message || "").slice(0, 500).trim();
    if (!message) return jsonResponse({ error: "Send JSON {\"message\": \"...\"}" }, 400);

    const clinics = await loadClinics(context);
    const parsed = parseQuestion(message, clinics);

    let { total, results } = filterClinics(clinics, {
      area: parsed.area, q: parsed.q, day: parsed.day, minutes: parsed.minutes, limit: MAX_RESULTS,
    });
    let relaxed = false;
    if (!results.length && parsed.minutes !== null) {
      // No clinic open at that exact time: relax the time filter, keep area/keywords.
      const again = filterClinics(clinics, { area: parsed.area, q: parsed.q, limit: MAX_RESULTS });
      if (again.results.length) { results = again.results; total = again.total; relaxed = true; }
    }

    const ctx = { ...parsed, relaxed };
    const nous = await nousAnswer(context, message, results, ctx);
    const llm = nous.answer;
    const answer = llm || fallbackAnswer(results, ctx);
    return jsonResponse({
      answer,
      results: results.map((c) => publicClinic(c, sgNow())),
      matched: total,
      relaxed,
      powered_by: llm ? `nous-portal:${nous.model}` : "deterministic-fallback",
      ...(llm ? {} : { llm_error: nous.error }),
      data_as_of: DATA_AS_OF, source: DATA_SOURCE,
    });
  } catch (err) {
    return jsonResponse({ error: String(err && err.message || err) }, 500);
  }
}

export function onRequestGet() {
  return jsonResponse({
    usage: "POST JSON {\"message\": \"Which PaedsENGAGE clinics in Tampines are open on Sunday morning?\"}",
    returns: "{answer, results[], matched, powered_by, data_as_of}",
    notes: "Filtering is deterministic; the Nous Portal free model only phrases answers from the filtered clinics. Without a configured key, a deterministic fallback answer is returned.",
    data_as_of: DATA_AS_OF, source: DATA_SOURCE,
  });
}
