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

import getpass
import json
import logging
import os
import random
import re
import sqlite3
import subprocess
import tempfile
import time
import urllib.parse
from pathlib import Path

log = logging.getLogger("merchant_intel.fbsession")

_FB_USER_FALLBACK = "user"


def _user_tag() -> str:
    """Filesystem-safe per-user tag; never fails."""
    try:
        raw = getpass.getuser()
    except Exception:  # noqa: BLE001 — an env quirk must not break import
        raw = _FB_USER_FALLBACK
    return re.sub(r"[^A-Za-z0-9_.-]", "_", raw or "") or _FB_USER_FALLBACK


def _private_cookie_dir() -> Path:
    """Per-user, non-world-readable directory for the copied cookie jar.

    Replaces the predictable, world-readable /tmp/.fbsess.sqlite, which is also
    unopenable on Windows (sqlite3 cannot create the missing parent path).
    """
    return Path(tempfile.gettempdir()) / f"merchant-intel-fbsess-{_user_tag()}"


def _default_cookie_db() -> str:
    return str(_private_cookie_dir() / ".fbsess.sqlite")


DEFAULT_COOKIE_DB = _default_cookie_db()

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

# Only these hosts are ever fetched; the "--" separator below is defence in
# depth so a model-authored URL can never be read as a curl option.
_FB_URL_PREFIXES = ("https://www.facebook.com/", "https://facebook.com/")
# Bound the bytes curl may write into the parent's memory.
_MAX_PAGE_BYTES = 5_000_000


def _allowed_fb_url(url: str) -> bool:
    return isinstance(url, str) and url.startswith(_FB_URL_PREFIXES)


def _curl_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _unlink(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def _curl_config_path(cookies: str) -> str | None:
    """Write a 0600 curl config carrying the Cookie header.

    The authenticated cookie never lands in the process argv (readable by any
    local user via the process list, and liable to be captured in crash dumps
    or audit logs)."""
    try:
        handle = tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", prefix="fbcurl-", suffix=".conf", delete=False
        )
    except OSError:
        return None
    path = handle.name
    try:
        with handle:
            handle.write(f'header = "Cookie: {_curl_escape(cookies)}"\n')
    except OSError:
        _unlink(path)
        return None
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return path


def load_cookie_header(db_path: str = DEFAULT_COOKIE_DB) -> str:
    """Return a Cookie header value from all facebook.com rows in the copied
    cookies.sqlite. Caller must copy the profile DB to a writable path first
    (Zen holds a lock on the live file). Degrades to "" for a missing or
    corrupt jar rather than crashing the caller."""
    directory = _private_cookie_dir()
    try:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(directory, 0o700)
    except OSError:
        pass
    conn = None
    try:
        conn = sqlite3.connect(db_path)
        rows = conn.execute(
            "SELECT name, value FROM moz_cookies WHERE host LIKE '%facebook%'"
        ).fetchall()
    except sqlite3.Error as exc:
        log.warning("cookie jar %s unreadable: %s", db_path, exc)
        return ""
    finally:
        if conn is not None:
            conn.close()
    try:
        os.chmod(db_path, 0o600)
    except OSError:
        pass
    return "; ".join(f"{name}={value}" for name, value in rows)

def fb_get(url: str, *, timeout: int = 20, cookie_header: str | None = None) -> tuple[int, str]:
    """GET a Facebook URL with the session cookie header via curl.
    Returns (http_status, body); status 0 on transport failure.
    No POST/PUT/DELETE path exists by construction."""
    if not _allowed_fb_url(url):
        log.warning("refusing to fetch non-Facebook URL")
        return 0, ""
    cookies = cookie_header if cookie_header is not None else load_cookie_header()
    # _CURL_HEADERS holds raw "Name: value" strings; each MUST be paired with
    # its own -H flag. Unpacking the tuple bare makes curl parse each header
    # string as an extra URL argument (verified failure: headers never sent,
    # FB serves HTTP 400).
    args = ["curl", "-s", "--compressed", "-L", "-A", USER_AGENT]
    args += ["--max-time", str(timeout), "--max-filesize", str(_MAX_PAGE_BYTES)]
    config_path = _curl_config_path(cookies) if cookies else None
    if config_path:
        args += ["--config", config_path]
    for header in _CURL_HEADERS:
        args += ["-H", header]
    # "--" ends option parsing before the URL operand.
    args += [
        "-w", "\n<<FB_STATUS:%{http_code}>>",
        "--",
        url,
    ]
    try:
        try:
            proc = subprocess.run(args, capture_output=True, timeout=timeout + 5)
        except (subprocess.TimeoutExpired, OSError):
            return 0, ""
    finally:
        if config_path:
            _unlink(config_path)
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
