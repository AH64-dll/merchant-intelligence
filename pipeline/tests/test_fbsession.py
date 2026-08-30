"""Offline tests for merchant_intel.fbsession — no network access."""

from __future__ import annotations

from unittest.mock import patch

from merchant_intel import fbsession

# Shaped like the real desktop group-search page: escaped story_fbid islands
# with publish_time metadata preceding each fbid; bodies are JS-rendered
# (absent server-side).
FIXTURE_SEARCH = (
    '<html><body><script type="application/json">'
    '{"require":[["RelayPrefetchedStream",["adp"],'
    '{"\\"post_context\\":{\\"object_fbtype\\":657,\\"publish_time\\":1787901690,'
    '"\\"story_name\\":\\"EntGroupMallPostCreationStory\\",\\"story_fbid\\":[\\"111111111\\"]},'
    '"\\"profile_id\\":\\"61584350477315\\"}]]}'
    "</script>"
    r'\"publish_time\":1781934742,\"story_name\":\"EntGroupMallPostCreationStory\",\"story_fbid\":[\"222222222\"]'
    r'\"publish_time\":1781110070,\"story_name\":\"EntStatusCreationStory\",\"story_fbid\":[\"333333333\"]'
    "</body></html>"
)

FIXTURE_LOGIN_WALL = """
<html><body>You must log in to continue. Join Facebook.</body></html>
"""


def test_search_group_posts_extracts_permalinks():
    with patch.object(fbsession, "fb_get", return_value=(200, FIXTURE_SEARCH)):
        results = fbsession.search_group_posts(
            "https://www.facebook.com/groups/hardware.market.eg/", "Al Sheikh Store"
        )
    assert len(results) == 3
    assert results[0]["permalink"].endswith("/posts/111111111")
    assert results[0]["time_label"] == "1787901690"
    assert results[1]["permalink"].endswith("/posts/222222222")
    assert results[2]["permalink"].endswith("/posts/333333333")
    # bodies are JS-rendered; snippets are always empty by contract
    assert all(r["snippet"] == "" for r in results)


def test_search_group_posts_login_wall_returns_empty():
    with patch.object(fbsession, "fb_get", return_value=(200, FIXTURE_LOGIN_WALL)):
        assert (
            fbsession.search_group_posts(
                "https://www.facebook.com/groups/hardware.market.eg/", "x"
            )
            == []
        )


def test_search_group_posts_bad_status_returns_empty():
    with patch.object(fbsession, "fb_get", return_value=(400, "")):
        assert (
            fbsession.search_group_posts(
                "https://www.facebook.com/groups/hardware.market.eg/", "x"
            )
            == []
        )


def test_search_group_posts_invalid_group_url():
    assert fbsession.search_group_posts("https://www.facebook.com/marketplace", "x") == []


def test_search_group_posts_dedupes_repeat_fbids():
    fixture = FIXTURE_SEARCH + FIXTURE_SEARCH
    with patch.object(fbsession, "fb_get", return_value=(200, fixture)):
        results = fbsession.search_group_posts(
            "https://www.facebook.com/groups/hardware.market.eg/", "x"
        )
    assert len(results) == 3


def test_fetch_post_text_proximity_rule():
    # Post body island sits close to the permalink's own post id -> returned.
    body = "كنت بدور على المراوح دى ريفيرس هل متوفره عند حد ست مراوح لون ابيض"
    fixture = (
        r'<html><script>"story_fbid\":\"' + "444444444" + r'\""</script>'
        r'<div class="x1lliihqx">filler</div>' * 40
        + '"message":{"text":"' + body + '"}'
        + "</html>"
    )
    with patch.object(fbsession, "fb_get", return_value=(200, fixture)):
        text = fbsession.fetch_post_text(
            "https://www.facebook.com/groups/g1/posts/444444444"
        )
    assert body.replace("\n", " ") in text


def test_fetch_post_text_distant_ads_excluded():
    # Ad text block far from any own-id occurrence -> excluded, empty result.
    fixture = (
        "<html>" + '<div class="pad">x</div>' * 2000
        + '"message":{"text":"$0 للبحث. $0 للاسترداد. لا بطاقة، لا تجربة مجانية."}'
        + "</html>"
    )
    with patch.object(fbsession, "fb_get", return_value=(200, fixture)):
        assert (
            fbsession.fetch_post_text(
                "https://www.facebook.com/groups/g1/posts/555555555"
            )
            == ""
        )


def test_verify_session_logged_in():
    with patch.object(fbsession, "fb_get", return_value=(200, "<html>logout</html>")):
        assert fbsession.verify_session() is True


def test_verify_session_login_page():
    with patch.object(
        fbsession, "fb_get", return_value=(200, "<html>log in to Facebook</html>")
    ):
        assert fbsession.verify_session() is False


def test_verify_session_non_200():
    with patch.object(fbsession, "fb_get", return_value=(500, "")):
        assert fbsession.verify_session() is False
