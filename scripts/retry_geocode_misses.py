#!/usr/bin/env python3
"""Retry geocoding for cache entries still marked not_found, using the clinic
name and street name as OneMap/Nominatim queries. Run after geocode_clinics.py.
"""
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geocode_clinics import CACHE, CLINICS, fetch_json, in_singapore, nominatim, onemap, postal_of


def main():
    clinics = json.loads(CLINICS.read_text())
    cache = json.loads(CACHE.read_text())
    misses = 0
    fixed = 0
    for c in clinics:
        postal = postal_of(c["address"])
        key = postal or re.sub(r"\s+", " ", c["address"].strip().lower())
        entry = cache.get(key)
        if entry and entry.get("lat") is not None:
            continue
        misses += 1
        street = c["address"].split(",")[0]
        queries = [
            ("onemap", c["clinic_name"]),
            ("onemap", f"{street}, Singapore"),
            ("nominatim", f"{c['clinic_name']}, {c['address']}"),
            ("nominatim", f"{street}, Singapore"),
        ]
        hit = None
        for provider, q in queries:
            try:
                hit = onemap(q) if provider == "onemap" else nominatim(q)
            except Exception as exc:
                print(f"  ! {provider} error {q[:40]}: {exc}", flush=True)
                hit = None
            time.sleep(1.1 if provider == "nominatim" else 0.25)
            if hit and in_singapore(hit[0], hit[1]):
                break
            hit = None
        if hit:
            cache[key] = {"lat": hit[0], "lng": hit[1], "source": hit[2] + "-retry", "display": hit[3]}
            fixed += 1
            print(f"  fixed {c['clinic_name'][:40]} -> {hit[2]}", flush=True)
        else:
            print(f"  still missing {c['clinic_name'][:40]} ({c['address'][:50]})", flush=True)
        CACHE.write_text(json.dumps(cache, indent=1))
    print(f"misses retried: {misses}, fixed: {fixed}")


if __name__ == "__main__":
    main()
