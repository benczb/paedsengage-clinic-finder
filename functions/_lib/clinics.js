// Shared clinic data access + deterministic filtering for the PaedsENGAGE API.
// Single source of truth: the static /data/clinics.json asset, fetched through
// the Pages ASSETS binding and cached in the isolate.

let cache = null;

export async function loadClinics(context) {
  if (cache) return cache;
  const url = new URL("/data/clinics.json", context.request.url);
  let res;
  if (context.env && context.env.ASSETS) {
    res = await context.env.ASSETS.fetch(url);
  } else {
    res = await fetch(url);
  }
  if (!res.ok) throw new Error(`clinics.json fetch failed: ${res.status}`);
  cache = await res.json();
  return cache;
}

const DAY_NAMES = ["Mon", "Tues", "Wed", "Thurs", "Fri", "Sat", "Sun"]; // dataset labels (note Tues/Thurs)
const DAY_FULL = {
  mon: "Mon", monday: "Mon", tue: "Tues", tues: "Tues", tuesday: "Tues",
  wed: "Wed", wednesday: "Wed", thu: "Thurs", thur: "Thurs", thurs: "Thurs", thursday: "Thurs",
  fri: "Fri", friday: "Fri", sat: "Sat", saturday: "Sat", sun: "Sun", sunday: "Sun",
};

export function normaliseDay(value) {
  if (!value) return null;
  return DAY_FULL[String(value).trim().toLowerCase()] || null;
}

// Current day/time in Singapore regardless of where the Worker runs.
export function sgNow(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const day = DAY_FULL[get("weekday").toLowerCase()];
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return { day, minutes };
}

export function clinicOpenAt(clinic, day, minutes) {
  const days = (clinic.schedule && clinic.schedule.days) || [];
  const entry = days.find((d) => d.day === day);
  if (!entry) return false;
  return (entry.time_blocks || []).some((b) => {
    const start = b.start_minutes, end = b.end_minutes;
    if (end > start) return minutes >= start && minutes < end;
    // overnight block (e.g. 20:00 - 02:00)
    return minutes >= start || minutes < end;
  });
}

export function todayHoursText(clinic, day) {
  const entry = ((clinic.schedule && clinic.schedule.days) || []).find((d) => d.day === day);
  if (!entry || !entry.time_blocks || !entry.time_blocks.length) return "Closed";
  return entry.time_blocks.map((b) => b.display || `${b.start}-${b.end}`).join(", ");
}

export function publicClinic(c, nowCtx) {
  const out = {
    id: c.id, slug: c.slug, name: c.clinic_name, area: c.location,
    address: c.address, postal_code: c.postal_code,
    phone: c.contact_primary, phones: c.contacts, doctors: c.doctors,
    latitude: c.latitude, longitude: c.longitude,
    google_maps_url: c.google_maps_url, page_url: c.page_url,
    opening_hours: c.opening_hours_schema, operating_hours_text: c.operating_hours_text,
  };
  if (nowCtx) out.open_now = clinicOpenAt(c, nowCtx.day, nowCtx.minutes);
  return out;
}

const STOPWORDS = new Set(("clinic clinics doctor doctors gp paedsengage paediatric pediatric kids kid child children " +
  "open opens opening hours hour near nearest me my in at on the a an any are is there show find please what which " +
  "singapore area areas today tomorrow tonight now morning afternoon evening night weekend weekday " +
  "monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun").split(" "));

// Deterministic filter used by /api/clinics and /api/chat.
export function filterClinics(clinics, { area, q, day, minutes, limit = 50, offset = 0 } = {}) {
  let list = clinics.slice();
  if (area) {
    const a = area.trim().toLowerCase();
    list = list.filter((c) => c.location.toLowerCase() === a);
  }
  if (q) {
    const tokens = q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOPWORDS.has(t));
    if (tokens.length) {
      list = list
        .map((c) => {
          const hay = `${c.clinic_name} ${c.location} ${c.address} ${(c.doctors || []).join(" ")}`.toLowerCase();
          const score = tokens.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
          return { c, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.c);
    }
  }
  if (day && minutes !== null && minutes !== undefined) {
    list = list.filter((c) => clinicOpenAt(c, day, minutes));
  }
  const total = list.length;
  return { total, results: list.slice(offset, offset + limit) };
}

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 1), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300",
    },
  });
}

export const DATA_AS_OF = "05 Oct 2026";
export const DATA_SOURCE = "Participating PaedsENGAGE Clinics PDF (KKH)";
