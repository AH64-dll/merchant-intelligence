"""Unit and integration tests for deep_resolve_sources module."""

from __future__ import annotations

import sqlite3
import pytest

from merchant_intel.deep_resolve_sources import (
    IDENTITY_CLAIM_TYPES,
    NOTE_DEAD,
    NOTE_FB_VENDOR_PAGE,
    LABEL_FB_VENDOR_PAGE,
    NOTE_REDIRECT_TO_HOME,
    path_segments,
    is_facebook_host,
    is_facebook_vendor_page,
    is_redirect_to_home,
    is_deeper_url,
    deep_resolve_sources,
)


def test_path_segments():
    assert path_segments("https://example.com")[0] == 0
    assert path_segments("https://example.com/")[0] == 0
    assert path_segments("https://example.com/foo")[0] == 1
    assert path_segments("https://example.com/foo/")[0] == 1
    assert path_segments("https://example.com/foo/bar")[0] == 2
    assert path_segments("https://example.com/foo/bar/baz/")[0] == 3


def test_is_facebook_host():
    assert is_facebook_host("facebook.com")
    assert is_facebook_host("www.facebook.com")
    assert is_facebook_host("m.facebook.com")
    assert is_facebook_host("fb.com")
    assert not is_facebook_host("google.com")
    assert not is_facebook_host("notfacebook.com")


def test_is_facebook_vendor_page():
    # Page root
    assert is_facebook_vendor_page("https://facebook.com/highend.store1/", 1, "/highend.store1/", "")
    # Mentions
    assert is_facebook_vendor_page("https://facebook.com/store/mentions/", 2, "/store/mentions/", "")
    # Photos
    assert is_facebook_vendor_page("https://facebook.com/store/photos/123", 3, "/store/photos/123", "")
    # Plugins embed
    assert is_facebook_vendor_page("https://facebook.com/plugins/page.php?href=xyz", 2, "/plugins/page.php", "href=xyz")
    # Specific post should not match
    assert not is_facebook_vendor_page("https://facebook.com/store/posts/123456", 3, "/store/posts/123456", "")
    # Specific video should not match
    assert not is_facebook_vendor_page("https://facebook.com/store/videos/123456", 3, "/store/videos/123456", "")


def test_is_redirect_to_home():
    # Deep path redirected to home / language root
    assert is_redirect_to_home(
        "https://www.bim.eg/content-ar/3/content.aspx",
        "https://www.bim.eg/"
    )
    assert is_redirect_to_home(
        "https://www.cairosales.com/ar/about-us",
        "https://cairosales.com/ar/"
    )
    # Shallow orig does not count as redirect to home
    assert not is_redirect_to_home("https://bim.eg", "https://bim.eg/")


def test_is_deeper_url():
    # Orig was shallow/post, target has more segments
    assert is_deeper_url(
        "https://facebook.com/page/posts/123",
        "https://facebook.com/page/videos/slug/456"
    )
    assert is_deeper_url(
        "https://maps.app.goo.gl/short",
        "https://www.google.com/maps/place/coord/data"
    )
    assert is_deeper_url(
        "https://almalnews.com/123/",
        "https://almalnews.com/123/full-article-title-slug"
    )
    # Mere language prefix on home is not deeper
    assert not is_deeper_url(
        "https://btech.com",
        "https://btech.com/ar"
    )


@pytest.fixture
def mock_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            canonical_url TEXT NOT NULL UNIQUE,
            platform TEXT NOT NULL,
            source_type TEXT NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            web_url TEXT,
            source_label TEXT NOT NULL DEFAULT '',
            locator_note TEXT NOT NULL DEFAULT '',
            access_kind TEXT NOT NULL DEFAULT 'web'
        );

        CREATE TABLE evidence (
            id TEXT PRIMARY KEY,
            merchant_id TEXT NOT NULL,
            source_id INTEGER NOT NULL,
            claim_id TEXT,
            claim_type TEXT NOT NULL,
            sentiment TEXT NOT NULL,
            summary TEXT NOT NULL
        );

        CREATE TABLE source_link_checks (
            source_id INTEGER NOT NULL PRIMARY KEY,
            status TEXT NOT NULL,
            checked_at TEXT NOT NULL,
            final_url TEXT,
            http_status INTEGER,
            detail TEXT NOT NULL DEFAULT ''
        );
    """)
    return conn


def test_deep_resolve_sources_dry_run_does_not_mutate(mock_db):
    mock_db.execute("""
        INSERT INTO sources (id, url, canonical_url, platform, source_type, first_seen_at, last_seen_at, web_url)
        VALUES (1, 'https://facebook.com/store/', 'https://facebook.com/store', 'facebook', 'social', 'now', 'now', 'https://facebook.com/store/')
    """)
    mock_db.execute("""
        INSERT INTO evidence (id, merchant_id, source_id, claim_type, sentiment, summary)
        VALUES ('e1', 'm1', 1, 'store_reputation', 'negative', 'Bad service')
    """)

    summary = deep_resolve_sources(mock_db, dry_run=True)
    assert summary.rows_fb_vendor_page_noted == 1

    row = mock_db.execute("SELECT locator_note, source_label FROM sources WHERE id = 1").fetchone()
    assert row["locator_note"] == ""
    assert row["source_label"] == ""


def test_deep_resolve_sources_transforms(mock_db):
    # 1. FB vendor page on claim evidence
    mock_db.execute("""
        INSERT INTO sources (id, url, canonical_url, platform, source_type, first_seen_at, last_seen_at, web_url)
        VALUES (1, 'https://facebook.com/store/', 'https://facebook.com/store', 'facebook', 'social', 'now', 'now', 'https://facebook.com/store/')
    """)
    mock_db.execute("""
        INSERT INTO evidence (id, merchant_id, source_id, claim_type, sentiment, summary)
        VALUES ('e1', 'm1', 1, 'warranty_issue', 'negative', 'Refused warranty')
    """)

    # 2. Identity claim only -> should skip
    mock_db.execute("""
        INSERT INTO sources (id, url, canonical_url, platform, source_type, first_seen_at, last_seen_at, web_url)
        VALUES (2, 'https://facebook.com/official/', 'https://facebook.com/official', 'facebook', 'social', 'now', 'now', 'https://facebook.com/official/')
    """)
    mock_db.execute("""
        INSERT INTO evidence (id, merchant_id, source_id, claim_type, sentiment, summary)
        VALUES ('e2', 'm1', 2, 'verified_business_information', 'neutral', 'Official address')
    """)

    # 3. Dead / unreachable link
    mock_db.execute("""
        INSERT INTO sources (id, url, canonical_url, platform, source_type, first_seen_at, last_seen_at, web_url)
        VALUES (3, 'https://store.com/deal', 'https://store.com/deal', 'web', 'website', 'now', 'now', 'https://store.com/deal')
    """)
    mock_db.execute("""
        INSERT INTO evidence (id, merchant_id, source_id, claim_type, sentiment, summary)
        VALUES ('e3', 'm1', 3, 'other', 'neutral', 'Deal info')
    """)
    mock_db.execute("""
        INSERT INTO source_link_checks (source_id, status, checked_at, http_status, detail)
        VALUES (3, 'not_found', 'now', 404, 'Not found')
    """)

    # 4. Deeper redirect upgrade
    mock_db.execute("""
        INSERT INTO sources (id, url, canonical_url, platform, source_type, first_seen_at, last_seen_at, web_url)
        VALUES (4, 'https://short.ly/news', 'https://short.ly/news', 'web', 'website', 'now', 'now', 'https://short.ly/news')
    """)
    mock_db.execute("""
        INSERT INTO evidence (id, merchant_id, source_id, claim_type, sentiment, summary)
        VALUES ('e4', 'm1', 4, 'other', 'neutral', 'News')
    """)
    mock_db.execute("""
        INSERT INTO source_link_checks (source_id, status, checked_at, final_url, http_status, detail)
        VALUES (4, 'redirected', 'now', 'https://news.com/2026/01/full-story', 200, 'Redirected')
    """)

    # 5. Redirect to home
    mock_db.execute("""
        INSERT INTO sources (id, url, canonical_url, platform, source_type, first_seen_at, last_seen_at, web_url)
        VALUES (5, 'https://old.com/deep/article/1', 'https://old.com/deep/article/1', 'web', 'website', 'now', 'now', 'https://old.com/deep/article/1')
    """)
    mock_db.execute("""
        INSERT INTO evidence (id, merchant_id, source_id, claim_type, sentiment, summary)
        VALUES ('e5', 'm1', 5, 'other', 'neutral', 'Article')
    """)
    mock_db.execute("""
        INSERT INTO source_link_checks (source_id, status, checked_at, final_url, http_status, detail)
        VALUES (5, 'redirected', 'now', 'https://old.com/', 200, 'Redirected to root')
    """)

    summary = deep_resolve_sources(mock_db, dry_run=False)

    assert summary.rows_fb_vendor_page_noted == 1
    assert summary.rows_identity_skipped == 1
    assert summary.rows_dead_noted == 1
    assert summary.rows_upgraded_deeper == 1
    assert summary.rows_redirect_home_kept == 1

    # Verify rows in DB
    s1 = mock_db.execute("SELECT locator_note, source_label FROM sources WHERE id = 1").fetchone()
    assert s1["locator_note"] == NOTE_FB_VENDOR_PAGE
    assert s1["source_label"] == LABEL_FB_VENDOR_PAGE

    s2 = mock_db.execute("SELECT locator_note, source_label FROM sources WHERE id = 2").fetchone()
    assert s2["locator_note"] == ""
    assert s2["source_label"] == ""

    s3 = mock_db.execute("SELECT locator_note FROM sources WHERE id = 3").fetchone()
    assert s3["locator_note"] == NOTE_DEAD

    s4 = mock_db.execute("SELECT web_url, canonical_url FROM sources WHERE id = 4").fetchone()
    assert s4["web_url"] == "https://news.com/2026/01/full-story"
    assert s4["canonical_url"] == "https://news.com/2026/01/full-story"

    s5 = mock_db.execute("SELECT web_url, locator_note FROM sources WHERE id = 5").fetchone()
    assert s5["web_url"] == "https://old.com/deep/article/1"
    assert s5["locator_note"] == NOTE_REDIRECT_TO_HOME
