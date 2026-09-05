"""Unit tests for the pure source-locator classification helpers."""

from __future__ import annotations

import pytest

from merchant_intel.sources import (
    ACCESS_KINDS,
    PLACEHOLDER_SUMMARY,
    SourceLocator,
    classify_source_locator,
    is_placeholder_summary,
    safe_http_url,
)

# Verbatim rows from data/merchant_intelligence.db (sources.url), read-only.
WHOIS_FIXTURES = (
    ("whois://fitandfix.com (Verisign registry output)", "fitandfix.com (Verisign registry output)"),
    ("whois://ecc-alex.com", "ecc-alex.com"),
    ("whois://oscarstores.com (Verisign .com registry via whois CLI)", "oscarstores.com (Verisign .com registry via whois CLI)"),
    ("whois:turbo-computer.com", "turbo-computer.com"),
)

ANNOTATED_FIXTURES = (
    (
        "https://whois.verisign-grs.com/ (record: highendstore.net)",
        "https://whois.verisign-grs.com/",
        "(record: highendstore.net)",
    ),
    (
        "https://www.cpa.gov.eg (site-restricted query: راية / Raya / Rayashop)",
        "https://www.cpa.gov.eg",
        "(site-restricted query: راية / Raya / Rayashop)",
    ),
    (
        "https://cpa.gov.eg/ar-eg/قضايا-وأحكام/PgrID/628/PageID/1 … PageID/7 (plus CategoryID/20 view)",
        "https://cpa.gov.eg/ar-eg/قضايا-وأحكام/PgrID/628/PageID/1",
        "… PageID/7 (plus CategoryID/20 view)",
    ),
)


def test_access_kinds_are_controlled():
    assert ACCESS_KINDS == ("web", "whois", "offline", "unknown")


@pytest.mark.parametrize(
    "raw",
    ["https://example.test/a", "http://example.test/a", "https://example.test/a?b=1&c=2#frag"],
)
def test_clean_http_url_is_web(raw):
    assert classify_source_locator(raw) == SourceLocator(raw, "", "web")


def test_trailing_slash_is_preserved():
    assert classify_source_locator("https://example.test/a/") == SourceLocator(
        "https://example.test/a/", "", "web"
    )


def test_scheme_is_lowercased_but_case_of_path_kept():
    assert classify_source_locator("HTTPS://Example.test/Path") == SourceLocator(
        "https://Example.test/Path", "", "web"
    )


def test_credentials_in_netloc_are_accepted():
    assert classify_source_locator("https://user:pw@example.test/a") == SourceLocator(
        "https://user:pw@example.test/a", "", "web"
    )


@pytest.mark.parametrize("raw, note", WHOIS_FIXTURES)
def test_whois_locators_from_master_db(raw, note):
    assert classify_source_locator(raw) == SourceLocator(None, note, "whois")


def test_whois_prefix_is_case_insensitive():
    assert classify_source_locator("WHOIS://Example.test") == SourceLocator(
        None, "Example.test", "whois"
    )


def test_whois_without_remainder():
    assert classify_source_locator("whois:") == SourceLocator(None, "", "whois")
    assert classify_source_locator("whois://") == SourceLocator(None, "", "whois")


@pytest.mark.parametrize("raw, web_url, note", ANNOTATED_FIXTURES)
def test_annotated_urls_from_master_db(raw, web_url, note):
    assert classify_source_locator(raw) == SourceLocator(web_url, note, "web")


def test_annotation_may_contain_parentheses_and_record_text():
    assert classify_source_locator("https://example.test/b (record: abc)") == SourceLocator(
        "https://example.test/b", "(record: abc)", "web"
    )


def test_multi_word_annotation_is_kept_whole():
    locator = classify_source_locator("https://example.test/c checked manually 2026-01-02")
    assert locator.access_kind == "web"
    assert locator.web_url == "https://example.test/c"
    assert locator.locator_note == "checked manually 2026-01-02"


def test_annotated_url_splits_on_first_whitespace_run():
    locator = classify_source_locator("https://example.test/d/e/f (one) (two) (three)")
    assert (locator.web_url, locator.locator_note) == (
        "https://example.test/d/e/f",
        "(one) (two) (three)",
    )


@pytest.mark.parametrize(
    "raw",
    [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "//host/path",
        "example.com/x",
        "ftp://example.test/a",
        "https://",
        "https:///a",
        "unknown",
    ],
)
def test_non_browser_safe_values_are_unknown(raw):
    locator = classify_source_locator(raw)
    assert locator.web_url is None
    assert locator.access_kind == "unknown"
    assert locator.locator_note == raw.strip()


@pytest.mark.parametrize("raw", [None, "", "   ", "\t\n"])
def test_missing_locator_is_unknown_with_empty_note(raw):
    assert classify_source_locator(raw) == SourceLocator(None, "", "unknown")


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("https://example.test/a", "https://example.test/a"),
        ("HTTPS://Example.test/A", "https://Example.test/A"),
        ("https://user:pw@example.test/a?b=1#c", "https://user:pw@example.test/a?b=1#c"),
    ],
)
def test_safe_http_url_accepts(raw, expected):
    assert safe_http_url(raw) == expected


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "javascript:alert(1)",
        "data:text/html,x",
        "//host/path",
        "example.com/x",
        "ftp://example.test/a",
        "https://",
        "https://example.test (record: 123)",
        " https://example.test/a",
        "https://example.test/a\tb",
        "https://exa mple.test/a",
    ],
)
def test_safe_http_url_rejects(value):
    assert safe_http_url(value) is None


@pytest.mark.parametrize(
    "text",
    [None, "", "   ", "\n\t", PLACEHOLDER_SUMMARY, PLACEHOLDER_SUMMARY.lower(), PLACEHOLDER_SUMMARY.upper(), "  " + PLACEHOLDER_SUMMARY + "  "],
)
def test_placeholder_summaries(text):
    assert is_placeholder_summary(text) is True


@pytest.mark.parametrize(
    "text",
    [
        "متجر يبيع أجهزة منزلية في القاهرة.",
        "Short note.",
        PLACEHOLDER_SUMMARY + " Extra context.",
        "Source cited without a model-supplied summary",
    ],
)
def test_real_summaries_are_not_placeholders(text):
    assert is_placeholder_summary(text) is False


def test_classification_is_idempotent_on_web_url():
    locator = classify_source_locator("https://example.test/e (record: 42)")
    again = classify_source_locator(locator.web_url)
    assert again == SourceLocator(locator.web_url, "", "web")
