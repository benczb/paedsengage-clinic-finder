#!/usr/bin/env python3
"""Geocode all clinics once and cache the results.

Writes data/geocode_cache.json mapping a cache key (postal code when the
address has one, otherwise the normalised address) to
{lat, lng, source, display}. Incremental: safe to re-run, cached entries are
never re-queried. scripts/enrich_clinics.py merges the cache into
data/clinics.json.

Providers, tried in order:
  1. OneMap (Singapore's official geocoder) by postal code, then by address.
  2. Nominatim / OpenStreetMap by full address, then by postal code.
     Nominatim usage policy: max 1 req/s, descriptive User-Agent (set below).

Usage: python3 scripts/geocode_clinics.py [--limit N] [--only-missing]
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CLINICS = DATA / "clinics.json"
CACHE = DATA / "geocode_cache.json"
UA = {"User-Agent": "childandkid-paedsengage-geocoder/1.0 (https://childandkid.com; one-off dataset build)"}


def fetch_json(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def postal_of(address):
    m = re.search(r"Singapore,?\s*(\d{6})", address or "")
    return m.group(1) if m else None


def onemap(query):
    url = "https://www.onemap.gov.sg/api/common/elastic/search?" + urllib.parse.urlencode(
        {"searchVal": query, "returnGeom": "Y", "getAddrDetails": "Y", "pageNum": 1}
    )
    r = fetch_json(url)
    if r.get("found") and r["results"]:
        top = r["results"][0]
        return float(top["LATITUDE"]), float(top["LONGITUDE"]), "onemap", top.get("ADDRESS", "")
    return None


def nominatim(query):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": query, "format": "json", "limit": 1, "countrycodes": "sg"}
    )
    r = fetch_json(url)
    if r:
        return float(r[0]["lat"]), float(r[0]["lon"]), "nominatim", r[0].get("display_name", "")
    return None


def in_singapore(lat, lng):
    return 1.22 <= lat <= 1.49 and 103.6 <= lng <= 104.05


def geocode(clinic):
    address = clinic["address"]
    postal = postal_of(address)
    attempts = []
    if postal:
        attempts.append(("onemap", postal))
    attempts.append(("onemap", address))
    attempts.append(("nominatim", f"{clinic['clinic_name']}, {address}"))
    if postal:
        attempts.append(("nominatim", f"Singapore {postal}"))
    for provider, query in attempts:
        try:
            hit = onemap(query) if provider == "onemap" else nominatim(query)
        except Exception as exc:  # network hiccup: record and try next provider
            print(f"  ! {provider} error for {query[:50]}: {exc}", flush=True)
            hit = None
        if provider == "nominatim":
            time.sleep(1.1)  # Nominatim policy: <= 1 req/s
        else:
            time.sleep(0.25)
        if hit and in_singapore(hit[0], hit[1]):
            return {"lat": hit[0], "lng": hit[1], "source": hit[2], "display": hit[3]}
    return None


def main():
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    clinics = json.loads(CLINICS.read_text())
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    todo = []
    for c in clinics:
        postal = postal_of(c["address"])
        key = postal or re.sub(r"\s+", " ", c["address"].strip().lower())
        c["_key"] = key
        if key not in cache:
            todo.append(c)
    print(f"{len(clinics)} clinics, {len(cache)} cached, {len(todo)} to geocode", flush=True)
    if limit:
        todo = todo[:limit]
    done = 0
    for c in todo:
        hit = geocode(c)
        cache[c["_key"]] = hit or {"lat": None, "lng": None, "source": "not_found", "display": ""}
        done += 1
        if done % 20 == 0 or not hit:
            print(f"  {done}/{len(todo)} {c['clinic_name'][:40]} -> {cache[c['_key']]['source']}", flush=True)
            CACHE.write_text(json.dumps(cache, indent=1))
    CACHE.write_text(json.dumps(cache, indent=1))
    found = sum(1 for v in cache.values() if v.get("lat") is not None)
    print(f"done: {found}/{len(cache)} cache entries have coordinates", flush=True)


if __name__ == "__main__":
    main()
