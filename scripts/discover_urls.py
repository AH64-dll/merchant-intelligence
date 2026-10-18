#!/usr/bin/env python3
"""Discover candidate source URLs for merchants using free, unauthenticated
endpoints: DuckDuckGo HTML, Reddit JSON, Nominatim (OSM), and Exa library.

Usage:
  discover_urls.py <batch.json> -o <candidates.json>

For each merchant in the batch file it emits a list of candidate URLs with a
`via` tag showing which channel surfaced it. Sub-agents verify these rather
than searching from scratch.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = {"User-Agent": "merchant-intel-discovery/1.0 (+research; contact: local)"}


def fetch(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception as ex:
        return f"__ERR__ {ex}"


DDG_LINK_RE = re.compile(r'href="([^"]*?uddg=([^"&]+)[^"]*)"')
DDG_RESULT_RE = re.compile(r'class="result__a"[^>]*href="([^"]+)"')


def ddg(query: str, limit: int = 6) -> list[dict]:
    url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(query)
    body = fetch(url)
    if body.startswith("__ERR__"):
        return []
    out: list[dict] = []
    for m in DDG_LINK_RE.finditer(body):
        u = urllib.parse.unquote(m.group(2))
        out.append({"via": "ddg", "url": u, "query": query})
    for m in DDG_RESULT_RE.finditer(body):
        u = html.unescape(m.group(1))
        if "uddg=" in u:
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)
            if "uddg" in qs:
                u = qs["uddg"][0]
        out.append({"via": "ddg", "url": u, "query": query})
    seen = set()
    uniq = []
    for r in out:
        if r["url"] in seen:
            continue
        seen.add(r["url"])
        uniq.append(r)
    return uniq[:limit]


def reddit(query: str, limit: int = 5) -> list[dict]:
    url = (
        "https://www.reddit.com/search.json?q="
        + urllib.parse.quote(query)
        + f"&limit={limit}&sort=relevance"
    )
    body = fetch(url)
    if body.startswith("__ERR__"):
        return []
    try:
        data = json.loads(body)
    except Exception:
        return []
    out = []
    for child in data.get("data", {}).get("children", []):
        d = child.get("data", {})
        permalink = d.get("permalink")
        if permalink:
            out.append(
                {
                    "via": "reddit",
                    "url": "https://www.reddit.com" + permalink,
                    "title": d.get("title", "")[:200],
                    "subreddit": d.get("subreddit", ""),
                    "score": d.get("score", 0),
                    "query": query,
                }
            )
    return out


def nominatim(name: str, city: str) -> list[dict]:
    q = f"{name}, {city}, Egypt" if city else f"{name}, Egypt"
    url = (
        "https://nominatim.openstreetmap.org/search?format=json&limit=3&q="
        + urllib.parse.quote(q)
    )
    body = fetch(url)
    if body.startswith("__ERR__"):
        return []
    try:
        data = json.loads(body)
    except Exception:
        return []
    out = []
    for r in data:
        out.append(
            {
                "via": "nominatim",
                "url": f"https://www.openstreetmap.org/{r.get('osm_type','node')}/{r.get('osm_id')}",
                "display_name": r.get("display_name", "")[:200],
                "lat": r.get("lat"),
                "lon": r.get("lon"),
            }
        )
    return out


def queries_for(merchant: dict) -> list[str]:
    name = merchant["canonical_name"]
    city = merchant.get("city", "")
    cat = merchant.get("category", "")
    qs = [
        f'"{name}" {city} Egypt',
        f'"{name}" {city} review',
        f'"{name}" facebook {city}',
        f'"{name}" yellowpages OR 140online OR daleel {city}',
        f'"{name}" {cat} {city}',
    ]
    return qs


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("batch", help="batch JSON file")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--sleep", type=float, default=1.0)
    args = p.parse_args()

    batch = json.loads(Path(args.batch).read_text())
    out = {}
    for m in batch.get("merchants", []):
        name = m["canonical_name"]
        city = m.get("city", "")
        hits: list[dict] = []
        for q in queries_for(m):
            hits += ddg(q)
            time.sleep(args.sleep)
        # reddit once (English only usually)
        hits += reddit(f"{name} {city}")
        time.sleep(args.sleep)
        hits += nominatim(name, city)
        # dedupe by URL
        seen = set()
        uniq = []
        for h in hits:
            if h["url"] in seen:
                continue
            seen.add(h["url"])
            uniq.append(h)
        out[m["id"]] = {
            "canonical_name": name,
            "city": city,
            "candidates": uniq[:25],
        }
        print(f"{name}: {len(uniq)} candidates", file=sys.stderr)

    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
