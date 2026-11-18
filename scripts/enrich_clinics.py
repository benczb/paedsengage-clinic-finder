#!/usr/bin/env python3
"""Enrich data/clinics.json from data/geocode_cache.json and derive bot-readable outputs.

Adds to every clinic:
  - postal_code (parsed from the address)
  - latitude / longitude (from the geocode cache; null when not found)
  - geocode_source ("onemap" / "nominatim" / "not_found")
  - id + slug (stable, unique: slugified name + postal code)
  - opening_hours_schema: schema.org openingHours strings, e.g. "Mo-Fr 09:00-12:00,13:00-15:00"
  - page_url: the static per-clinic page path

Also writes:
  - data/clinics.geojson  (GeoJSON FeatureCollection of geocoded clinics)
  - llms-full.txt         (one line per clinic, for LLM ingestion)
  - sitemap.xml           (home + area pages + clinic pages)

Run scripts/geocode_clinics.py first. Re-runnable: slugs are deterministic.
"""
import json
import re
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
BASE = "https://childandkid.com"
DATA_DATE = "2026-10-05"  # KKH PDF accuracy date
DAY_SCHEMA = {"Mon": "Mo", "Tues": "Tu", "Wed": "We", "Thurs": "Th", "Fri": "Fr", "Sat": "Sa", "Sun": "Su"}
DAY_ORDER = ["Mon", "Tues", "Wed", "Thurs", "Fri", "Sat", "Sun"]


def slugify(text):
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s or "clinic"


def postal_of(address):
    m = re.search(r"Singapore,?\s*(\d{6})", address or "")
    return m.group(1) if m else None


def opening_hours_schema(schedule):
    days = {d["day"]: d for d in (schedule or {}).get("days", [])}
    # group consecutive days (Mon..Sun) sharing the same block set
    groups = []  # (start_idx, end_idx, blocks_key)
    for i, day in enumerate(DAY_ORDER):
        blocks = tuple(
            (b["start"], b["end"]) for b in days.get(day, {}).get("time_blocks", [])
        )
        if not blocks:
            continue
        if groups and groups[-1][2] == blocks and groups[-1][1] == i - 1:
            groups[-1] = (groups[-1][0], i, blocks)
        else:
            groups.append((i, i, blocks))
    out = []
    for start, end, blocks in groups:
        label = DAY_SCHEMA[DAY_ORDER[start]]
        if end != start:
            label += "-" + DAY_SCHEMA[DAY_ORDER[end]]
        times = ",".join(f"{s}-{e}" for s, e in blocks)
        out.append(f"{label} {times}")
    return out


def main():
    clinics = json.loads((DATA / "clinics.json").read_text())
    cache = {}
    if (DATA / "geocode_cache.json").exists():
        cache = json.loads((DATA / "geocode_cache.json").read_text())

    used_slugs = set()
    for c in clinics:
        postal = postal_of(c["address"])
        c["postal_code"] = postal
        key = postal or re.sub(r"\s+", " ", c["address"].strip().lower())
        hit = cache.get(key) or {}
        c["latitude"] = hit.get("lat")
        c["longitude"] = hit.get("lng")
        c["geocode_source"] = hit.get("source", "pending")
        base_slug = slugify(c["clinic_name"])
        if postal:
            base_slug += "-" + postal
        slug, n = base_slug, 2
        while slug in used_slugs:
            slug = f"{base_slug}-{n}"
            n += 1
        used_slugs.add(slug)
        c["id"] = slug
        c["slug"] = slug
        c["opening_hours_schema"] = opening_hours_schema(c.get("schedule"))
        c["page_url"] = f"{BASE}/clinics/{slug}/"

    (DATA / "clinics.json").write_text(json.dumps(clinics, indent=1, ensure_ascii=False))

    # --- GeoJSON ---
    features = []
    for c in clinics:
        if c["latitude"] is None or c["longitude"] is None:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [c["longitude"], c["latitude"]]},
                "properties": {
                    "id": c["id"],
                    "name": c["clinic_name"],
                    "area": c["location"],
                    "address": c["address"],
                    "postal_code": c["postal_code"],
                    "phone": c["contact_primary"],
                    "doctors": c["doctors"],
                    "opening_hours": c["opening_hours_schema"],
                    "google_maps_url": c["google_maps_url"],
                    "page_url": c["page_url"],
                },
            }
        )
    geojson = {
        "type": "FeatureCollection",
        "name": "PaedsENGAGE participating GP clinics, Singapore",
        "metadata": {
            "source": "Participating PaedsENGAGE Clinics PDF (KKH), accurate as of 05 Oct 2026",
            "generated_from": f"{BASE}/data/clinics.json",
            "clinic_count": len(clinics),
            "geocoded_count": len(features),
            "coordinate_sources": "OneMap (Singapore Land Authority) primary; OpenStreetMap Nominatim fallback",
        },
        "features": features,
    }
    (DATA / "clinics.geojson").write_text(json.dumps(geojson, indent=1, ensure_ascii=False))

    # --- llms-full.txt ---
    areas = sorted({c["location"] for c in clinics})
    lines = [
        "# PaedsENGAGE Clinic Finder — full clinic index",
        "",
        "> Every participating PaedsENGAGE paediatric GP clinic in Singapore: name, area, address, phone,",
        "> doctors, opening hours, coordinates and a Google Maps link. Source: Participating PaedsENGAGE",
        "> Clinics PDF (KKH), accurate as of 05 Oct 2026. Machine-readable data: /data/clinics.json,",
        "> /data/clinics.geojson, /data/clinics.csv. Query API: /api/clinics (see /api/openapi.json).",
        "",
        f"Total clinics: {len(clinics)} across {len(areas)} areas.",
        "",
    ]
    for area in areas:
        lines.append(f"## {area}")
        for c in [x for x in clinics if x["location"] == area]:
            hours = "; ".join(c["opening_hours_schema"]) or "see page"
            coords = (
                f"{c['latitude']},{c['longitude']}" if c["latitude"] is not None else "not geocoded"
            )
            lines.append(
                f"- {c['clinic_name']} — {c['address']} — Tel {c['contact_primary']} — "
                f"Hours (schema.org): {hours} — Coords: {coords} — "
                f"Maps: {c['google_maps_url']} — Page: {c['page_url']}"
            )
        lines.append("")
    (ROOT / "llms-full.txt").write_text("\n".join(lines))

    # --- sitemap.xml ---
    urls = [(f"{BASE}/", DATA_DATE)]
    for area in areas:
        urls.append((f"{BASE}/areas/{slugify(area)}/", DATA_DATE))
    for c in clinics:
        urls.append((c["page_url"], DATA_DATE))
    body = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, lastmod in urls:
        body.append(f"  <url><loc>{loc}</loc><lastmod>{lastmod}</lastmod></url>")
    body.append("</urlset>")
    (ROOT / "sitemap.xml").write_text("\n".join(body) + "\n")

    geocoded = sum(1 for c in clinics if c["latitude"] is not None)
    print(f"enriched {len(clinics)} clinics; geocoded {geocoded}; areas {len(areas)}; sitemap urls {len(urls)}")


if __name__ == "__main__":
    main()
