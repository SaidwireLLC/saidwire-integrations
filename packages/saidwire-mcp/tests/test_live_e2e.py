"""Live tests against the real Saidwire API, run through a real MCP client over stdio.

    SAIDWIRE_API_KEY=sk_live_... SAIDWIRE_TEST_AUDIO=/abs/clip.wav pytest -m live -v

Optional: SAIDWIRE_TEST_URL=https://.../public.wav also exercises a real public download.
The no-key test runs without a key (no network).
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import shutil
import sys
import threading
from pathlib import Path

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from saidwire_mcp import client as c

KEY = os.environ.get("SAIDWIRE_API_KEY", "")
AUDIO = os.environ.get("SAIDWIRE_TEST_AUDIO", "")
PUBLIC_URL = os.environ.get("SAIDWIRE_TEST_URL", "")

needs_live = pytest.mark.skipif(not (KEY and AUDIO and Path(AUDIO).is_file()),
                                reason="set SAIDWIRE_API_KEY and SAIDWIRE_TEST_AUDIO")


def _params(env_extra: dict[str, str]) -> StdioServerParameters:
    env = {k: v for k, v in os.environ.items() if k not in ("SAIDWIRE_API_KEY",)}
    env.update(env_extra)
    return StdioServerParameters(command=sys.executable, args=["-m", "saidwire_mcp"], env=env)


async def _call(env_extra: dict[str, str], tool: str, args: dict) -> tuple[bool, str, list[str]]:
    async with stdio_client(_params(env_extra)) as (r, w):
        async with ClientSession(r, w) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = [t.name for t in tools.tools]
            res = await session.call_tool(tool, args)
            text = "".join(getattr(x, "text", "") for x in res.content)
            return bool(res.isError if hasattr(res, "isError") else res.is_error), text, names


async def test_mcp_no_key_error_points_to_signup(tmp_path):
    f = tmp_path / "a.wav"
    f.write_bytes(b"RIFF....")
    is_err, text, names = await _call({"SAIDWIRE_API_KEY": ""}, "transcribe_file", {"path": str(f)})
    assert {"transcribe_file", "transcribe_url"} <= set(names)
    assert is_err and "https://saidwire.com/dev" in text


@pytest.mark.live
@needs_live
def test_live_client_direct():
    st = c.Settings.from_env()
    data, ctype, _ = c.read_local_file(AUDIO)
    res = c.transcribe_bytes(st, data, ctype)
    text = c.transcript_of(res)
    print("\nDIRECT:", text)
    assert len(text.split()) >= 5 and c.words_of(res)


@pytest.mark.live
@needs_live
async def test_live_mcp_transcribe_file_text_and_srt(tmp_path):
    is_err, text, _ = await _call({"SAIDWIRE_API_KEY": KEY}, "transcribe_file", {"path": AUDIO})
    print("\nMCP text:", text)
    assert not is_err and len(text.split()) >= 5

    out = tmp_path / "clip.srt"
    is_err, srt, _ = await _call({"SAIDWIRE_API_KEY": KEY}, "transcribe_file",
                                 {"path": AUDIO, "format": "srt", "output_path": str(out)})
    assert not is_err and "-->" in srt and out.read_text().startswith("1\n00:00:")
    print("MCP srt:\n" + out.read_text())

    is_err, js, _ = await _call({"SAIDWIRE_API_KEY": KEY}, "transcribe_file",
                                {"path": AUDIO, "format": "json", "include_words": True})
    d = json.loads(js)
    assert not is_err and d["words"] and d["words"][0]["end"] > d["words"][0]["start"]


@pytest.mark.live
@needs_live
async def test_live_mcp_transcribe_url_local_server(tmp_path):
    """transcribe_url through MCP: the server downloads from a local HTTP server, then transcribes."""
    shutil.copy(AUDIO, tmp_path / "clip.wav")
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(tmp_path))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/clip.wav"
        env = {"SAIDWIRE_API_KEY": KEY, "SAIDWIRE_ALLOW_PRIVATE_URLS": "1"}
        is_err, vtt, _ = await _call(env, "transcribe_url", {"url": url, "format": "vtt"})
        print("\nMCP url vtt:\n" + vtt)
        assert not is_err and vtt.startswith("WEBVTT")

        # Without the opt-in, local addresses are refused.
        is_err, msg, _ = await _call({"SAIDWIRE_API_KEY": KEY}, "transcribe_url", {"url": url})
        assert is_err and "private" in msg
    finally:
        httpd.shutdown()


@pytest.mark.live
@pytest.mark.skipif(not (KEY and PUBLIC_URL), reason="set SAIDWIRE_TEST_URL")
async def test_live_mcp_transcribe_public_url():
    is_err, text, _ = await _call({"SAIDWIRE_API_KEY": KEY}, "transcribe_url", {"url": PUBLIC_URL})
    print("\nMCP public url:", text)
    assert not is_err and len(text.split()) >= 3
