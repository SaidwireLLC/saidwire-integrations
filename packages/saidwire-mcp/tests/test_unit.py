"""Offline unit tests: no network, the API is replaced by httpx.MockTransport."""

import json

import httpx
import pytest

from saidwire_mcp import client as c
from saidwire_mcp import server as s

KEY = "sk_live_unit01.secretsecret"

RESULT = {
    "metadata": {"request_id": "req-1", "duration": 6.0},
    "results": {
        "channels": [
            {
                "alternatives": [
                    {
                        "transcript": "Hello there. How are you today?",
                        "words": [
                            {"word": "hello", "punctuated_word": "Hello", "start": 0.5, "end": 0.8, "confidence": 0.9},
                            {"word": "there", "punctuated_word": "there.", "start": 0.9, "end": 1.2, "confidence": 0.9},
                            {"word": "how", "punctuated_word": "How", "start": 3.0, "end": 3.2, "confidence": 0.9},
                            {"word": "are", "punctuated_word": "are", "start": 3.25, "end": 3.4, "confidence": 0.9},
                            {"word": "you", "punctuated_word": "you", "start": 3.45, "end": 3.6, "confidence": 0.9},
                            {"word": "today", "punctuated_word": "today?", "start": 3.65, "end": 4.1, "confidence": 0.9},
                        ],
                    }
                ]
            }
        ],
        "utterances": [
            {"start": 0.5, "end": 1.2, "transcript": "Hello there."},
            {"start": 3.0, "end": 4.1, "transcript": "How are you today?"},
        ],
    },
}


def settings(**kw):
    return c.Settings(api_key=KEY, **kw)


# ------------------------------------------------------------------ settings


def test_missing_key_points_to_signup():
    with pytest.raises(c.SaidwireError) as e:
        c.Settings.from_env({})
    assert "https://saidwire.com/dev" in str(e.value)
    assert "SAIDWIRE_API_KEY" in str(e.value)


def test_bad_key_shape():
    with pytest.raises(c.SaidwireError) as e:
        c.Settings.from_env({"SAIDWIRE_API_KEY": "dg_12345"})
    assert "saidwire.com/dev" in str(e.value)


def test_key_quotes_stripped_and_limits():
    st = c.Settings.from_env({"SAIDWIRE_API_KEY": f'"{KEY}"', "SAIDWIRE_MAX_DOWNLOAD_MB": "5",
                              "SAIDWIRE_API_URL": "http://x/"})
    assert st.api_key == KEY and st.base_url == "http://x" and st.max_download_bytes == 5 * 1024 * 1024
    st = c.Settings.from_env({"SAIDWIRE_API_KEY": KEY, "SAIDWIRE_MAX_DOWNLOAD_MB": "99999"})
    assert st.max_download_bytes == c.API_MAX_BYTES


def test_content_types():
    assert c.content_type_for("a.MP3") == "audio/mpeg"
    assert c.content_type_for("https://x.com/p/a.m4a?sig=1") == "audio/mp4"
    assert c.content_type_for("blob", "audio/x-wav; charset=binary") == "audio/x-wav"
    assert c.content_type_for("blob", "text/plain") == "application/octet-stream"


# ------------------------------------------------------------------ API calls


def test_transcribe_sends_auth_and_params():
    seen = {}

    def handler(req: httpx.Request):
        seen["auth"] = req.headers["authorization"]
        seen["ctype"] = req.headers["content-type"]
        seen["params"] = dict(req.url.params)
        seen["path"] = req.url.path
        seen["body"] = req.content
        return httpx.Response(200, json=RESULT)

    out = c.transcribe_bytes(settings(), b"RIFFdata", "audio/wav", transport=httpx.MockTransport(handler))
    assert out == RESULT
    assert seen["auth"] == f"Token {KEY}"
    assert seen["path"] == "/v1/listen"
    assert seen["params"] == {"punctuate": "true", "utterances": "true"}
    assert seen["ctype"] == "audio/wav" and seen["body"] == b"RIFFdata"


@pytest.mark.parametrize(
    "status,body,needle",
    [
        (401, {"err_code": "INVALID_AUTH", "err_msg": "Invalid credentials.", "request_id": "r1"}, "saidwire.com/dev"),
        (402, {"err_code": "QUOTA_EXCEEDED", "err_msg": "Quota."}, "used up"),
        (403, {"err_code": "KEY_REVOKED", "err_msg": "Revoked."}, "revoked"),
        (413, {"err_code": "AUDIO_TOO_LONG", "err_msg": "Too long."}, "60 minutes"),
        (503, {"err_code": "SERVICE_OFFLINE", "err_msg": "Offline."}, "Retry after 30"),
    ],
)
def test_api_errors_are_readable(status, body, needle):
    t = httpx.MockTransport(lambda r: httpx.Response(status, json=body, headers={"retry-after": "30"}))
    with pytest.raises(c.SaidwireError) as e:
        c.transcribe_bytes(settings(), b"x", "audio/wav", transport=t)
    msg = str(e.value)
    assert needle in msg and body["err_code"] in msg
    assert KEY not in msg


def test_network_error_is_readable():
    def boom(req):
        raise httpx.ConnectError("refused")

    with pytest.raises(c.SaidwireError, match="Could not reach"):
        c.transcribe_bytes(settings(), b"x", "audio/wav", transport=httpx.MockTransport(boom))


def test_empty_audio_rejected():
    with pytest.raises(c.SaidwireError, match="empty"):
        c.transcribe_bytes(settings(), b"", "audio/wav")


# ------------------------------------------------------------------ files


def test_read_local_file(tmp_path):
    p = tmp_path / "a.flac"
    p.write_bytes(b"fLaC....")
    data, ctype, resolved = c.read_local_file(str(p))
    assert data == b"fLaC...." and ctype == "audio/flac" and resolved == str(p)


def test_read_local_file_errors(tmp_path):
    with pytest.raises(c.SaidwireError, match="not found"):
        c.read_local_file(str(tmp_path / "nope.wav"))
    with pytest.raises(c.SaidwireError, match="Not a file"):
        c.read_local_file(str(tmp_path))
    (tmp_path / "e.wav").write_bytes(b"")
    with pytest.raises(c.SaidwireError, match="empty"):
        c.read_local_file(str(tmp_path / "e.wav"))


# ------------------------------------------------------------------ downloads


def test_download_ok():
    t = httpx.MockTransport(lambda r: httpx.Response(200, content=b"ID3abc", headers={"content-type": "audio/mpeg"}))
    data, ctype = c.download(settings(), "https://example.com/x", transport=t, allow_private=True)
    assert data == b"ID3abc" and ctype == "audio/mpeg"


def test_download_size_cap_declared():
    t = httpx.MockTransport(lambda r: httpx.Response(200, content=b"x" * 10, headers={"content-length": str(10**9)}))
    with pytest.raises(c.SaidwireError, match="download limit"):
        c.download(settings(), "https://example.com/a.mp3", transport=t, allow_private=True)


def test_download_size_cap_streamed():
    def handler(req):
        return httpx.Response(200, stream=httpx.ByteStream(b"x" * 3000))

    st = settings(max_download_bytes=1000)
    with pytest.raises(c.SaidwireError, match="larger than"):
        c.download(st, "https://example.com/a.mp3", transport=httpx.MockTransport(handler), allow_private=True)


def test_download_rejects_html_and_bad_scheme_and_http_errors():
    t = httpx.MockTransport(lambda r: httpx.Response(200, content=b"<html>", headers={"content-type": "text/html"}))
    with pytest.raises(c.SaidwireError, match="web page"):
        c.download(settings(), "https://example.com/page", transport=t, allow_private=True)
    with pytest.raises(c.SaidwireError, match="http"):
        c.download(settings(), "file:///etc/passwd")
    t404 = httpx.MockTransport(lambda r: httpx.Response(404))
    with pytest.raises(c.SaidwireError, match="HTTP 404"):
        c.download(settings(), "https://example.com/a.mp3", transport=t404, allow_private=True)


def test_download_blocks_private_hosts():
    for u in ("http://127.0.0.1/a.wav", "http://localhost/a.wav", "http://169.254.169.254/latest", "http://10.0.0.5/a.wav"):
        with pytest.raises(c.SaidwireError, match="private"):
            c.download(settings(), u, allow_private=False)


# ------------------------------------------------------------------ formatting


def test_render_text_and_words():
    assert c.render(RESULT) == "Hello there. How are you today?"
    t = c.render(RESULT, "text", include_words=True)
    assert "Words (start s, end s, word)" in t and "today?" in t


def test_render_json():
    d = json.loads(c.render(RESULT, "json", include_words=True))
    assert d["transcript"].startswith("Hello") and d["duration_s"] == 6.0 and len(d["words"]) == 6
    assert d["utterances"][1]["transcript"] == "How are you today?"
    assert "words" not in json.loads(c.render(RESULT, "json"))


def test_srt():
    srt = c.render(RESULT, "srt")
    assert srt == (
        "1\n00:00:00,500 --> 00:00:01,200\nHello there.\n\n"
        "2\n00:00:03,000 --> 00:00:04,100\nHow are you today?\n"
    )


def test_vtt():
    vtt = c.render(RESULT, "vtt")
    assert vtt.startswith("WEBVTT\n\n00:00:00.500 --> 00:00:01.200\nHello there.\n")


def test_cues_split_long_runs():
    words = [{"word": f"w{i}", "start": i * 0.3, "end": i * 0.3 + 0.25, "confidence": 1} for i in range(100)]
    res = {"results": {"channels": [{"alternatives": [{"transcript": "x", "words": words}]}]}}
    cues = c.cues_of(res)
    assert len(cues) > 3
    assert all(b - a <= 7.0 + 1e-6 and len(t) <= 84 for a, b, t in cues)


def test_timestamp_hours():
    assert c._ts(3725.0429, ",") == "01:02:05,043"


def test_empty_result():
    empty = {"metadata": {"duration": 2.0}, "results": {"channels": [{"alternatives": [{"transcript": "", "words": []}]}]}}
    assert c.render(empty) == "(no speech found in the audio)"
    assert c.render(empty, "srt") == ""


def test_unknown_format():
    with pytest.raises(c.SaidwireError, match="Unknown format"):
        c.render(RESULT, "docx")


# ------------------------------------------------------------------ server glue


def test_save_output(tmp_path):
    out = s._save("abc", str(tmp_path / "o.srt"))
    assert (tmp_path / "o.srt").read_text() == "abc\n" and "Saved to" in out
    with pytest.raises(c.SaidwireError, match="absolute"):
        s._save("abc", "rel.srt")
    assert s._save("abc", None) == "abc"


async def test_tools_registered():
    tools = await s.mcp.list_tools()
    names = {t.name for t in tools}
    assert {"transcribe_file", "transcribe_url"} <= names
    tf = next(t for t in tools if t.name == "transcribe_file")
    props = tf.inputSchema["properties"] if hasattr(tf, "inputSchema") else tf.input_schema["properties"]
    assert set(props) >= {"path", "format", "include_words", "output_path"}
