#!/usr/bin/env python3
"""Generate static per-area and per-clinic pages into dist/.

These pages put every clinic's facts in raw HTML (no JavaScript needed) so
search engines, AI crawlers and parents' agents can read them directly.
Called by scripts/build.sh after the core files are copied into dist/.
Each page carries schema.org JSON-LD (MedicalClinic / ItemList), the KKH
source attribution and the data accuracy date.
"""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
BASE = "https://childandkid.com"
DATA_DATE_HUMAN = "05 Oct 2026"
DAY_FULL = {"Mon": "Monday", "Tues": "Tuesday", "Wed": "Wednesday", "Thurs": "Thursday",
            "Fri": "Friday", "Sat": "Saturday", "Sun": "Sunday"}


def esc(s):
    return html.escape(str(s or ""), quote=True)


def slugify(text):
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s or "clinic"


def hours_rows(c):
    rows = []
    for line in c.get("operating_hours_text", []):
        rows.append(f"<li>{esc(line)}</li>")
    return "\n".join(rows)


def opening_spec(c):
    spec = []
    for d in (c.get("schedule") or {}).get("days", []):
        for b in d.get("time_blocks", []):
            spec.append({
                "@type": "OpeningHoursSpecification",
                "dayOfWeek": DAY_FULL.get(d["day"], d["day"]),
                "opens": b["start"],
                "closes": b["end"],
            })
    return spec


PAGE_CSS = """
.static-page{max-width:880px;margin:0 auto;padding:24px 16px 48px}
.static-page h1{font-size:1.9rem;line-height:1.2}
.fact-table{border-collapse:collapse;width:100%;margin:16px 0}
.fact-table th,.fact-table td{border:1px solid #e3e9f5;padding:10px 12px;text-align:left;vertical-align:top}
.fact-table th{width:170px;background:#f6f8ff}
.clinic-list{list-style:none;padding:0}
.clinic-list li{border:1px solid #e3e9f5;border-radius:14px;padding:14px 16px;margin:10px 0;background:#fff}
.crumb{font-size:.9rem;color:#5f6f89}
.asof{color:#5f6f89;font-size:.92rem}
.btn{display:inline-block;background:#7c3aed;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:700}
"""


def shell(title, desc, body, jsonld):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="stylesheet" href="/styles.css">
<style>{PAGE_CSS}</style>
<script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>
</head>
<body>
<main class="static-page">
{body}
<footer>
<p class="asof">Data: Participating PaedsENGAGE Clinics PDF (KKH), accurate as of {DATA_DATE_HUMAN}. Always call the clinic to confirm hours before visiting. Coordinates: OneMap (SLA) / OpenStreetMap contributors.</p>
<p><a href="/">Back to the PaedsENGAGE clinic finder</a> · <a href="/areas/">All areas</a></p>
</footer>
</main>
</body>
</html>
"""


def clinic_page(c):
    doctors = ", ".join(c.get("doctors", [])) or "See clinic listing"
    geo = {}
    if c.get("latitude") is not None:
        geo = {"@type": "GeoCoordinates", "latitude": c["latitude"], "longitude": c["longitude"]}
    jsonld = {
        "@context": "https://schema.org",
        "@type": "MedicalClinic",
        "name": c["clinic_name"],
        "url": c["page_url"],
        "telephone": c["contact_primary"],
        "address": {"@type": "PostalAddress", "streetAddress": c["address"],
                    "postalCode": c["postal_code"], "addressCountry": "SG"},
        "geo": geo,
        "hasMap": c["google_maps_url"],
        "openingHoursSpecification": opening_spec(c),
        "medicalSpecialty": "Pediatric",
        "isPartOf": {"@type": "WebSite", "name": "PaedsENGAGE Clinic Finder", "url": BASE + "/"},
    }
    hours_schema = "; ".join(c["opening_hours_schema"]) or "See hours below"
    body = f"""
<nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/areas/{slugify(c['location'])}/">{esc(c['location'])}</a> › {esc(c['clinic_name'])}</nav>
<h1>{esc(c['clinic_name'])} — PaedsENGAGE clinic in {esc(c['location'])}</h1>
<h2>Where is {esc(c['clinic_name'])} and when is it open?</h2>
<p>{esc(c['clinic_name'])} is a participating PaedsENGAGE GP clinic at {esc(c['address'])}. Call <a href="tel:+65{esc(c['contact_primary'])}">{esc(c['contact_primary'])}</a> to book or confirm hours. Opening hours (summary): {esc(hours_schema)}.</p>
<table class="fact-table">
<tr><th>Address</th><td>{esc(c['address'])}</td></tr>
<tr><th>Phone</th><td><a href="tel:+65{esc(c['contact_primary'])}">{esc(c['contact_primary'])}</a></td></tr>
<tr><th>Doctors</th><td>{esc(doctors)}</td></tr>
<tr><th>Area</th><td><a href="/areas/{slugify(c['location'])}/">{esc(c['location'])}</a></td></tr>
<tr><th>Opening hours</th><td><ul>{hours_rows(c)}</ul></td></tr>
</table>
<p><a class="btn" href="{esc(c['google_maps_url'])}" target="_blank" rel="noreferrer">Open in Google Maps</a></p>
"""
    title = f"{c['clinic_name']} ({c['location']}) | PaedsENGAGE Clinic — Address, Phone, Opening Hours"
    desc = f"{c['clinic_name']}, a PaedsENGAGE paediatric GP clinic at {c['address']}. Phone {c['contact_primary']}. Opening hours: {hours_schema}. Data as of {DATA_DATE_HUMAN}."
    return shell(title, desc, body, jsonld)


def area_page(area, clinics):
    items = []
    lis = []
    for i, c in enumerate(clinics, 1):
        items.append({"@type": "ListItem", "position": i,
                      "url": c["page_url"], "name": c["clinic_name"]})
        hours_schema = "; ".join(c["opening_hours_schema"]) or "see page"
        lis.append(
            f'<li><strong><a href="/clinics/{c["slug"]}/">{esc(c["clinic_name"])}</a></strong><br>'
            f'{esc(c["address"])}<br>Tel <a href="tel:+65{esc(c["contact_primary"])}">{esc(c["contact_primary"])}</a>'
            f'<br>Hours: {esc(hours_schema)}<br><a href="{esc(c["google_maps_url"])}" target="_blank" rel="noreferrer">Google Maps</a></li>'
        )
    jsonld = {"@context": "https://schema.org", "@type": "ItemList",
              "name": f"PaedsENGAGE clinics in {area}", "itemListElement": items}
    body = f"""
<nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> › {esc(area)}</nav>
<h1>PaedsENGAGE clinics in {esc(area)}, Singapore</h1>
<h2>Which PaedsENGAGE paediatric GP clinics are in {esc(area)}?</h2>
<p>There are {len(clinics)} participating PaedsENGAGE clinics in {esc(area)}, as of {DATA_DATE_HUMAN}. PaedsENGAGE is the KKH/NUH programme that lets children see a GP for subsidised paediatric care and be referred back to the hospital when needed.</p>
<ul class="clinic-list">
{chr(10).join(lis)}
</ul>
"""
    title = f"PaedsENGAGE Clinics in {area} | {len(clinics)} Paediatric GP Clinics — Addresses, Phones, Hours"
    desc = f"All {len(clinics)} participating PaedsENGAGE paediatric GP clinics in {area}, Singapore: addresses, phone numbers, opening hours and map links. Data as of {DATA_DATE_HUMAN}."
    return shell(title, desc, body, jsonld)


def areas_index(areas):
    lis = "\n".join(
        f'<li><a href="/areas/{slugify(a)}/">{esc(a)}</a> — {n} clinic{"s" if n != 1 else ""}</li>'
        for a, n in areas
    )
    jsonld = {"@context": "https://schema.org", "@type": "CollectionPage",
              "name": "PaedsENGAGE clinics by area", "url": f"{BASE}/areas/"}
    body = f"""
<nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> › Areas</nav>
<h1>Find PaedsENGAGE clinics by area in Singapore</h1>
<h2>Which areas have PaedsENGAGE clinics?</h2>
<p>PaedsENGAGE clinics cover {len(areas)} areas across Singapore, as of {DATA_DATE_HUMAN}. Pick an area to see every participating clinic with its address, phone and opening hours.</p>
<ul>
{lis}
</ul>
"""
    return shell("PaedsENGAGE Clinics by Area | All 51 Areas in Singapore",
                 "Browse participating PaedsENGAGE paediatric GP clinics by area in Singapore.", body, jsonld)


def main():
    clinics = json.loads((ROOT / "data" / "clinics.json").read_text())
    by_area = {}
    for c in clinics:
        by_area.setdefault(c["location"], []).append(c)
    n_clinic = n_area = 0
    for c in clinics:
        p = DIST / "clinics" / c["slug"]
        p.mkdir(parents=True, exist_ok=True)
        (p / "index.html").write_text(clinic_page(c))
        n_clinic += 1
    areas_sorted = sorted(by_area.items())
    for area, cs in areas_sorted:
        p = DIST / "areas" / slugify(area)
        p.mkdir(parents=True, exist_ok=True)
        (p / "index.html").write_text(area_page(area, cs))
        n_area += 1
    p = DIST / "areas"
    p.mkdir(parents=True, exist_ok=True)
    (p / "index.html").write_text(areas_index([(a, len(cs)) for a, cs in areas_sorted]))
    print(f"generated {n_clinic} clinic pages, {n_area} area pages + areas index")


if __name__ == "__main__":
    main()
