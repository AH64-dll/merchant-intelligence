"""Offline tests for merchant_intel.fbsession — no network access.

Also carries the offline regression tests for the FB-path scrubber
(fb_swarm.scrub_text) and the portable omp child-terminate decision
(omp.client._signal_tree); neither spawns a real process.
"""

from __future__ import annotations

import asyncio
import signal
import tempfile
from unittest.mock import patch

import pytest

from merchant_intel import fb_swarm
from merchant_intel import fbsession
from merchant_intel.config import load_config
from merchant_intel.omp import client as omp_client
from merchant_intel.schemas import LunaAgentOutput, LunaFinding

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


# --- FB-path scrubber (fb_swarm.scrub_text) ---------------------------------

SCRUB_POSITIVE = [
    ("profile https://www.facebook.com/john.doe.5", "[community member]"),
    ("see facebook.com/profile.php?id=100012345", "[community member]"),
    ("ref facebook.com/people/John-Doe/12345", "[community member]"),
    ("mirror mbasic.facebook.com/john.doe", "[community member]"),
    ("call 01012345678 now", "[redacted phone]"),
    ("call +201012345678 now", "[redacted phone]"),
    ("landline 0223456789", "[redacted phone]"),
    ("ping @john_doe here", "[community member]"),
]

SCRUB_NEGATIVE = [
    "https://www.facebook.com/groups/hardware.market.eg/",
    "https://www.facebook.com/marketplace",
    "https://www.facebook.com/groups/12345/posts/999",
    "see notfacebook.com/john.doe",
    "email buyer@example.com",
    "price 4500 EGP only",
    "order code 0123456789",
]


@pytest.mark.parametrize(("raw", "marker"), SCRUB_POSITIVE)
def test_scrub_text_positive(raw, marker):
    scrubbed = fb_swarm.scrub_text(raw)
    assert marker in scrubbed
    assert raw != scrubbed


@pytest.mark.parametrize("raw", SCRUB_NEGATIVE)
def test_scrub_text_negative(raw):
    assert fb_swarm.scrub_text(raw) == raw


def test_scrub_text_empty_is_passthrough():
    assert fb_swarm.scrub_text("") == ""


def test_scrub_author_handles_cleans_all_free_text_fields():
    output = LunaAgentOutput(
        findings=[
            LunaFinding(
                task_id="t1",
                summary="ask https://www.facebook.com/john.doe.5",
                notes="call 01012345678",
                evidence=[
                    {
                        "source_url": "https://www.facebook.com/groups/g1/posts/1",
                        "source_platform": "facebook",
                        "summary": "profile facebook.com/people/John-Doe/12",
                        "raw_quote": "@john_doe said it",
                        "supporting_notes": ["+201012345678"],
                        "sentiment": "neutral",
                        "confidence": 0.5,
                    }
                ],
            )
        ]
    )
    fb_swarm.scrub_author_handles(output)
    finding = output.findings[0]
    assert "john.doe" not in finding.summary
    assert "01012345678" not in finding.notes
    evidence = finding.evidence[0]
    assert "people/John-Doe" not in evidence.summary
    assert "@john_doe" not in evidence.raw_quote
    assert all("201012345678" not in note for note in evidence.supporting_notes)


# --- Portable omp child termination (omp.client._signal_tree) ---------------


class _FakeProc:
    """Minimal process double: records terminate()/kill() without spawning."""

    def __init__(self, pid: int = 4321) -> None:
        self.pid = pid
        self.returncode = None
        self.terminated = 0
        self.killed = 0

    def terminate(self) -> None:
        self.terminated += 1

    def kill(self) -> None:
        self.killed += 1


def test_taskkill_argv_is_pure():
    assert omp_client._taskkill_argv(99) == ["taskkill", "/T", "/F", "/PID", "99"]


def test_signal_tree_windows_prefers_taskkill(monkeypatch):
    calls = []

    class _Completed:
        returncode = 0

    def fake_run(argv, **_kwargs):
        calls.append(argv)
        return _Completed()

    monkeypatch.setattr(omp_client.subprocess, "run", fake_run)
    proc = _FakeProc()
    omp_client._signal_tree(proc, signal.SIGTERM, use_process_group=False, is_windows=True)
    assert calls == [["taskkill", "/T", "/F", "/PID", "4321"]]
    assert proc.terminated == 0 and proc.killed == 0


def test_signal_tree_uses_killpg_when_available(monkeypatch):
    seen = []

    def fake_killpg(pid, sig):
        seen.append((pid, sig))

    monkeypatch.setattr(omp_client.os, "killpg", fake_killpg, raising=False)
    proc = _FakeProc()
    omp_client._signal_tree(
        proc, signal.SIGTERM, use_process_group=True, is_windows=False
    )
    assert seen == [(proc.pid, signal.SIGTERM)]
    assert proc.terminated == 0 and proc.killed == 0


def test_signal_tree_falls_back_to_kill_when_taskkill_missing(monkeypatch):
    def fake_run(_argv, **_kwargs):
        raise FileNotFoundError("taskkill not found")

    monkeypatch.setattr(omp_client.subprocess, "run", fake_run)
    proc = _FakeProc()
    omp_client._signal_tree(
        proc, omp_client._SIGKILL, force=True, use_process_group=False, is_windows=True
    )
    assert proc.killed == 1 and proc.terminated == 0


def test_signal_tree_terminates_gracefully_first(monkeypatch):
    def fake_run(_argv, **_kwargs):
        raise OSError("taskkill unavailable")

    monkeypatch.setattr(omp_client.subprocess, "run", fake_run)
    proc = _FakeProc()
    omp_client._signal_tree(proc, signal.SIGTERM, use_process_group=False, is_windows=True)
    assert proc.terminated == 1 and proc.killed == 0


def test_signal_tree_never_raises(monkeypatch):
    def exploding(*_args, **_kwargs):
        raise OSError("dead process")

    monkeypatch.setattr(omp_client.os, "killpg", exploding, raising=False)
    monkeypatch.setattr(omp_client.subprocess, "run", exploding)
    proc = _FakeProc()
    proc.kill = exploding
    proc.terminate = exploding
    # Must not raise even though every signalling route fails.
    omp_client._signal_tree(
        proc, omp_client._SIGKILL, force=True, use_process_group=True, is_windows=True
    )


def test_drain_stream_caps_bytes():
    async def run(cap):
        reader = asyncio.StreamReader()
        reader.feed_data(b"x" * 100)
        reader.feed_eof()
        return await omp_client._drain_stream(reader, cap)

    data, truncated = asyncio.run(run(10))
    assert data == b"x" * 10
    assert truncated is True
    data, truncated = asyncio.run(run(100))
    assert data == b"x" * 100
    assert truncated is False


def test_list_models_timeout_degrades_to_empty(monkeypatch):
    class _Caps:
        binary = "omp"
        raw_model_listing = ""
        models_invocation = ("models", "--json")

    async def hung(*_args, **_kwargs):
        raise TimeoutError("hung prompt")

    monkeypatch.setattr(omp_client, "_run_text", hung)
    client = omp_client.OmpClient(load_config(smoke=True), caps=_Caps())
    assert asyncio.run(client.list_models()) == []


def test_terminate_skips_finished_process(monkeypatch):
    called = []
    monkeypatch.setattr(omp_client, "_signal_tree", lambda *a, **k: called.append(1))

    class _Proc:
        returncode = 0
        pid = 5

    asyncio.run(omp_client.OmpClient(load_config(smoke=True))._terminate(_Proc()))
    assert called == []


def test_terminate_escalates_after_grace(monkeypatch):
    calls = []
    monkeypatch.setattr(
        omp_client,
        "_signal_tree",
        lambda proc, sig, **kw: calls.append((sig, kw.get("force", False))),
    )

    class _Proc:
        returncode = None
        pid = 1

        async def wait(self):
            return 0

    cfg = load_config(smoke=True)
    cfg.omp.kill_grace_sec = 0  # first grace window expires immediately
    asyncio.run(omp_client.OmpClient(cfg)._terminate(_Proc()))
    assert calls == [(signal.SIGTERM, False), (omp_client._SIGKILL, True)]


# --- Cookie-jar privacy / curl argv hardening -------------------------------


def test_default_cookie_db_is_private_location():
    assert fbsession.DEFAULT_COOKIE_DB != "/tmp/.fbsess.sqlite"
    assert fbsession.DEFAULT_COOKIE_DB.startswith(tempfile.gettempdir())
    assert fbsession.DEFAULT_COOKIE_DB.endswith(".fbsess.sqlite")


def test_load_cookie_header_missing_jar_returns_empty(tmp_path):
    missing_dir = tmp_path / "does-not-exist" / "nested" / "cookies.sqlite"
    assert fbsession.load_cookie_header(str(missing_dir)) == ""
    # A file that exists but is not a Mozilla cookie DB also degrades to "".
    bogus = tmp_path / "bogus.sqlite"
    bogus.write_bytes(b"not a database")
    assert fbsession.load_cookie_header(str(bogus)) == ""


def test_fb_get_rejects_non_facebook_url(monkeypatch):
    def fail_run(*_args, **_kwargs):
        raise AssertionError("curl must not run for a non-Facebook URL")

    monkeypatch.setattr(fbsession.subprocess, "run", fail_run)
    assert fbsession.fb_get("-o/tmp/x", cookie_header="c_user=1") == (0, "")
    assert fbsession.fb_get("https://evil.example/x", cookie_header="c_user=1") == (0, "")


def test_fb_get_keeps_cookie_out_of_argv(monkeypatch):
    captured = {}

    class _Completed:
        returncode = 0
        stdout = b"<html>ok</html>\n<<FB_STATUS:200>>"

    def fake_run(argv, **_kwargs):
        captured["argv"] = argv
        # The --config file is removed in fb_get's finally, so read it now.
        if "--config" in argv:
            with open(argv[argv.index("--config") + 1], encoding="utf-8") as handle:
                captured["config"] = handle.read()
        return _Completed()

    monkeypatch.setattr(fbsession.subprocess, "run", fake_run)
    status, body = fbsession.fb_get(
        "https://www.facebook.com/groups/g1/", cookie_header="c_user=1; xs=secret"
    )
    argv = captured["argv"]
    assert status == 200
    assert argv[argv.index("--") + 1] == "https://www.facebook.com/groups/g1/"
    assert "--max-time" in argv and "--max-filesize" in argv
    assert argv.count("--") == 1
    assert not any("secret" in str(part) for part in argv)
    assert "--config" in argv
    assert "Cookie: c_user=1; xs=secret" in captured["config"]

