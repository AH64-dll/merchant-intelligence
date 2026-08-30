"""Read-only Facebook session access for community-feedback harvesting.

Policy: the account owner authorizes READ-ONLY access to groups they
legitimately belong to. This module contains no code path for posting,
liking, commenting, joining, or messaging — only GET requests. Commenter
identities must never be persisted; callers scrub handles before ingest
(see fb_swarm.scrub_author_handles).

Transport: Facebook rejects Python-urllib and plain-curl fingerprints for
this cookie jar with HTTP 400; the empirically working shape is curl with
Sec-Fetch navigation headers (see _CURL_HEADERS). The header-string cookie
form works; the Netscape jar form does not.
"""

from __future__ import annotations

import json
import random
import re
import sqlite3
import subprocess
import time
import urllib.parse

DEFAULT_COOKIE_DB = "/tmp/.fbsess.sqlite"

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0"

_CURL_HEADERS = (
    "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language: en-US,en;q=0.5",
    "Sec-Fetch-Dest: document",
    "Sec-Fetch-Mode: navigate",
    "Sec-Fetch-Site: none",
    "Upgrade-Insecure-Requests: 1",
)

_POST_PERMALINK_RE = re.compile(
    r"https?://www\.facebook\.com/groups/([A-Za-z0-9_.-]+)/posts/(\d+)"
)
_TIME_LABEL_RE = re.compile(
    r"\b(\d+\s*(?:h|hr|hrs|hour|hours|m|min|mins|d|day|days|w|wk|week|weeks))\s*ago\b",
    re.IGNORECASE,
)
_LOGIN_MARKERS = ("login", "log in", "join facebook", "you must log in")

def load_cookie_header(db_path: str = DEFAULT_COOKIE_DB) -> str:
    """Return a Cookie header value from all facebook.com rows in the copied
    cookies.sqlite. Caller must copy the profile DB to a writable path first
    (Zen holds a lock on the live file)."""
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            "SELECT name, value FROM moz_cookies WHERE host LIKE '%facebook%'"
        ).fetchall()
    finally:
        conn.close()
    return "; ".join(f"{name}={value}" for name, value in rows)

def fb_get(url: str, *, timeout: int = 20, cookie_header: str | None = None) -> tuple[int, str]:
    """GET a Facebook URL with the session cookie header via curl.
    Returns (http_status, body); status 0 on transport failure.
    No POST/PUT/DELETE path exists by construction."""
    cookies = cookie_header if cookie_header is not None else load_cookie_header()
    # _CURL_HEADERS holds raw "Name: value" strings; each MUST be paired with
    # its own -H flag. Unpacking the tuple bare makes curl parse each header
    # string as an extra URL argument (verified failure: headers never sent,
    # FB serves HTTP 400).
    args = ["curl", "-s", "--compressed", "-L", "-A", USER_AGENT]
    args += ["-H", f"Cookie: {cookies}"]
    for header in _CURL_HEADERS:
        args += ["-H", header]
    args += [
        "-w", "\n<<FB_STATUS:%{http_code}>>",
        url,
    ]
    try:
        proc = subprocess.run(args, capture_output=True, timeout=timeout)
    except (subprocess.TimeoutExpired, OSError):
        return 0, ""
    if proc.returncode != 0:
        return 0, ""
    raw = proc.stdout.decode("utf-8", errors="replace")
    marker_pos = raw.rfind("\n<<FB_STATUS:")
    if marker_pos == -1:
        return 0, raw
    body = raw[:marker_pos]
    status_raw = raw[marker_pos + len("\n<<FB_STATUS:") :].rstrip(">").rstrip("\n")
    try:
        return int(status_raw), body
    except ValueError:
        return 0, body


def pace_between_fetches(min_seconds: float = 2.0, max_seconds: float = 5.0) -> None:
    """Human-pace delay between Facebook fetches from the same session."""
    time.sleep(min_seconds + random.random() * (max_seconds - min_seconds))


def verify_session(*, cookie_header: str | None = None) -> bool:
    """True iff the session cookie is logged in (home page shows a logout
    marker rather than the login wall)."""
    status, html = fb_get("https://www.facebook.com/", cookie_header=cookie_header)
    if status != 200:
        return False
    lowered = html.lower()
    if any(marker in lowered for marker in _LOGIN_MARKERS) and "logout" not in lowered:
        return False
    return "logout" in lowered or "c_user" in html


def search_group_posts(
    group_url: str,
    query: str,
    *,
    max_posts: int = 8,
    timeout: int = 20,
    cookie_header: str | None = None,
) -> list[dict[str, str]]:
    """Search a group's posts READ-ONLY. Returns dicts
    {permalink, snippet, time_label}; empty list when blocked, challenge-served,
    or no matches.

    Empirically (2026-08-30): the desktop group-search page embeds result
    post IDs as escaped story_fbid JSON islands; post BODIES are JS-rendered
    and neither the search page nor the permalink page nor mbasic/touch
    consent-walled mirrors expose them server-side. So this returns
    permalinks + publish timestamps with empty snippets; the swarm runner
    pre-fetches each permalink and passes whatever text IS present to
    agents. Findings without quotable content stay still_unresolved."""
    slug_match = re.search(r"/groups/([A-Za-z0-9_.-]+)", group_url)
    if not slug_match:
        return []
    slug = slug_match.group(1)
    url = (
        "https://www.facebook.com/groups/" + urllib.parse.quote(slug)
        + "/search?q=" + urllib.parse.quote(query)
    )
    status, html = fb_get(url, timeout=timeout, cookie_header=cookie_header)
    if status != 200:
        return []
    lowered = html.lower()
    if any(marker in lowered for marker in _LOGIN_MARKERS) and "logout" not in lowered:
        return []
    results: list[dict[str, str]] = []
    seen: set[str] = set()
    fbid_re = re.compile(r'story_fbid\\":\[\\"(\d+)\\"\]')
    for match in fbid_re.finditer(html):
        fbid = match.group(1)
        if fbid in seen:
            continue
        seen.add(fbid)
        tail = html[max(0, match.start() - 4000) : match.start()]
        time_match = re.search(r'\\"publish_time\\":(\d+)', tail)
        time_label = time_match.group(1) if time_match else ""
        results.append(
            {
                "permalink": f"https://www.facebook.com/groups/{slug}/posts/{fbid}",
                "snippet": "",
                "time_label": time_label,
            }
        )
        if len(results) >= max_posts:
            break
    return results


def fetch_post_text(permalink: str, *, timeout: int = 25, cookie_header: str | None = None) -> str:
    """Fetch a post permalink READ-ONLY and return readable text islands
    near the post's own ID (the post body if server-rendered). Post bodies
    are usually JS-rendered, so an empty result is the common case, not an
    error. Ad/footer text is excluded by the proximity rule."""
    status, html = fb_get(permalink, timeout=timeout, cookie_header=cookie_header)
    if status != 200:
        return ""
    own_id = permalink.rstrip("/").split("/")[-1]
    own_positions = [m.start() for m in re.finditer(re.escape(own_id), html)]
    blocks = [(m.start(), m.group(1)) for m in re.finditer(r'"message":\{"text":"((?:[^"\\]|\\.)*)"', html)]
    chunks: list[str] = []
    for pos, raw in blocks:
        if not own_positions or min(abs(pos - o) for o in own_positions) > 30000:
            continue
        try:
            text = json.loads(f'"{raw}"')
        except Exception:
            text = raw
        text = text.replace("\\n", " ").strip()
        if len(text) >= 25:
            chunks.append(text)
    return "\n---\n".join(chunks[:6])
