"""Small HTTP client for the Saidwire pre-recorded API, plus SRT/VTT rendering.

Kept free of MCP imports so it can be unit-tested and reused on its own.
"""

from __future__ import annotations

import ipaddress
import json
import os
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from . import __version__

SIGNUP_URL = "https://saidwire.com/dev"
DOCS_URL = "https://saidwire.com/docs/api"
DEFAULT_BASE_URL = "https://api.saidwire.com"

# The API accepts up to 100 MB and 60 minutes per request.
API_MAX_BYTES = 100 * 1024 * 1024
DEFAULT_MAX_DOWNLOAD_MB = 100
DOWNLOAD_TIMEOUT_S = 60.0
# A 60-minute file can take a while to transcribe; leave generous room.
REQUEST_TIMEOUT_S = 600.0

CONTENT_TYPES = {
    ".wav": "audio/wav",
    ".wave": "audio/wav",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/ogg",
    ".webm": "audio/webm",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".aac": "audio/aac",
}


class SaidwireError(Exception):
    """An error with a message that is safe and useful to show to the user."""


@dataclass
class Settings:
    api_key: str
    base_url: str = DEFAULT_BASE_URL
    max_download_bytes: int = DEFAULT_MAX_DOWNLOAD_MB * 1024 * 1024

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Settings":
        env = dict(os.environ if env is None else env)
        key = (env.get("SAIDWIRE_API_KEY") or "").strip().strip('"').strip("'")
        if not key:
            raise SaidwireError(
                "SAIDWIRE_API_KEY is not set. Get a free key (120 free hours, no card) at "
                f"{SIGNUP_URL}, then add it to the \"env\" block of this server in your MCP "
                "client config and restart the client."
            )
        if not (key.startswith("sk_live_") or key.startswith("sk_test_")):
            raise SaidwireError(
                "SAIDWIRE_API_KEY does not look like a Saidwire key (it should start with "
                f"sk_live_). Copy the full key from {SIGNUP_URL}."
            )
        base = (env.get("SAIDWIRE_API_URL") or DEFAULT_BASE_URL).rstrip("/")
        try:
            mb = float(env.get("SAIDWIRE_MAX_DOWNLOAD_MB") or DEFAULT_MAX_DOWNLOAD_MB)
        except ValueError:
            mb = DEFAULT_MAX_DOWNLOAD_MB
        mb = max(1.0, min(mb, API_MAX_BYTES / 1024 / 1024))
        return cls(api_key=key, base_url=base, max_download_bytes=int(mb * 1024 * 1024))


def content_type_for(name: str, fallback: str | None = None) -> str:
    ext = Path(urlparse(name).path if "://" in name else name).suffix.lower()
    if ext in CONTENT_TYPES:
        return CONTENT_TYPES[ext]
    if fallback and (fallback.startswith("audio/") or fallback.startswith("video/")):
        return fallback.split(";")[0].strip()
    return "application/octet-stream"


def _error_from_response(r: httpx.Response) -> SaidwireError:
    try:
        body = r.json()
    except (ValueError, json.JSONDecodeError):
        body = {}
    code = body.get("err_code") or ""
    msg = body.get("err_msg") or r.text[:200]
    rid = body.get("request_id") or r.headers.get("x-request-id") or ""
    retry = r.headers.get("retry-after")
    hint = {
        401: f"The API key was not accepted. Check SAIDWIRE_API_KEY, or get a free key at {SIGNUP_URL}.",
        402: f"This key's included hours are used up. Add hours or a card at {SIGNUP_URL}.",
        403: f"This key was revoked. Create a new one at {SIGNUP_URL}.",
        413: "The audio is too large (limit 100 MB and 60 minutes per request). Split it and retry.",
        429: "Too many requests at once for this key.",
        503: "The service is temporarily unavailable.",
    }.get(r.status_code, "")
    parts = [f"Saidwire API error {r.status_code}" + (f" {code}" if code else "") + f": {msg}"]
    if hint:
        parts.append(hint)
    if retry and r.status_code in (429, 503):
        parts.append(f"Retry after {retry} s.")
    if rid:
        parts.append(f"(request_id {rid})")
    return SaidwireError(" ".join(parts))


def transcribe_bytes(
    settings: Settings,
    data: bytes,
    content_type: str,
    *,
    transport: httpx.BaseTransport | None = None,
) -> dict[str, Any]:
    if not data:
        raise SaidwireError("The audio is empty.")
    if len(data) > API_MAX_BYTES:
        raise SaidwireError("The audio is larger than the 100 MB per-request limit. Split it and retry.")
    params = {"punctuate": "true", "utterances": "true"}
    headers = {
        "Authorization": f"Token {settings.api_key}",
        "Content-Type": content_type,
        "User-Agent": f"saidwire-mcp/{__version__}",
    }
    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_S, transport=transport) as c:
            r = c.post(f"{settings.base_url}/v1/listen", params=params, headers=headers, content=data)
    except httpx.TimeoutException as e:
        raise SaidwireError(f"The Saidwire API did not answer in time ({e.__class__.__name__}). Try again.") from e
    except httpx.HTTPError as e:
        raise SaidwireError(f"Could not reach the Saidwire API at {settings.base_url}: {e}") from e
    if r.status_code != 200:
        raise _error_from_response(r)
    try:
        return r.json()
    except ValueError as e:
        raise SaidwireError("The Saidwire API returned a response that is not JSON.") from e


def read_local_file(path: str) -> tuple[bytes, str, str]:
    """Return (bytes, content_type, resolved_path) for a local audio file."""
    if not path or not path.strip():
        raise SaidwireError("No file path was given.")
    p = Path(os.path.expandvars(path.strip())).expanduser()
    if not p.is_absolute():
        p = Path.cwd() / p
    if not p.exists():
        raise SaidwireError(f"File not found: {p}. Pass an absolute path to an audio file.")
    if not p.is_file():
        raise SaidwireError(f"Not a file: {p}")
    size = p.stat().st_size
    if size == 0:
        raise SaidwireError(f"The file is empty: {p}")
    if size > API_MAX_BYTES:
        raise SaidwireError(
            f"The file is {size / 1024 / 1024:.0f} MB; the limit is 100 MB (and 60 minutes) per request."
        )
    return p.read_bytes(), content_type_for(p.name), str(p)


def _is_public_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return True  # let the HTTP client report the DNS failure
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return False
    return True


def download(
    settings: Settings,
    url: str,
    *,
    transport: httpx.BaseTransport | None = None,
    allow_private: bool | None = None,
) -> tuple[bytes, str]:
    """Download a public audio URL with a size cap. Returns (bytes, content_type)."""
    u = urlparse((url or "").strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise SaidwireError("Only http:// and https:// URLs are supported.")
    if allow_private is None:
        allow_private = os.environ.get("SAIDWIRE_ALLOW_PRIVATE_URLS", "") == "1"
    if not allow_private and not _is_public_host(u.hostname):
        raise SaidwireError(
            "That URL points to a private or local address. Use transcribe_file for local files, "
            "or set SAIDWIRE_ALLOW_PRIVATE_URLS=1."
        )
    cap = settings.max_download_bytes
    buf = bytearray()
    try:
        with httpx.Client(
            timeout=DOWNLOAD_TIMEOUT_S,
            follow_redirects=True,
            transport=transport,
            headers={"User-Agent": f"saidwire-mcp/{__version__}"},
        ) as c:
            with c.stream("GET", u.geturl()) as r:
                if r.status_code != 200:
                    raise SaidwireError(f"Download failed: HTTP {r.status_code} from {u.hostname}.")
                declared = r.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > cap:
                    raise SaidwireError(
                        f"The file is {int(declared) / 1024 / 1024:.0f} MB; the download limit is "
                        f"{cap / 1024 / 1024:.0f} MB."
                    )
                ctype = r.headers.get("content-type", "")
                if ctype.startswith("text/html"):
                    raise SaidwireError(
                        "That URL returned a web page, not an audio file. Use a direct link to the audio."
                    )
                for chunk in r.iter_bytes():
                    buf.extend(chunk)
                    if len(buf) > cap:
                        raise SaidwireError(f"The download is larger than the {cap / 1024 / 1024:.0f} MB limit.")
    except httpx.TimeoutException as e:
        raise SaidwireError(f"The download timed out after {DOWNLOAD_TIMEOUT_S:.0f} s.") from e
    except httpx.HTTPError as e:
        raise SaidwireError(f"Download failed: {e}") from e
    if not buf:
        raise SaidwireError("The download was empty.")
    return bytes(buf), content_type_for(u.path, ctype)


# ---------------------------------------------------------------- formatting


def _alt(result: dict[str, Any]) -> dict[str, Any]:
    try:
        return result["results"]["channels"][0]["alternatives"][0]
    except (KeyError, IndexError, TypeError):
        return {}


def transcript_of(result: dict[str, Any]) -> str:
    return (_alt(result).get("transcript") or "").strip()


def words_of(result: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for w in _alt(result).get("words") or []:
        out.append(
            {
                "word": w.get("punctuated_word") or w.get("word", ""),
                "start": round(float(w.get("start", 0.0)), 3),
                "end": round(float(w.get("end", 0.0)), 3),
                "confidence": round(float(w.get("confidence", 0.0)), 3),
            }
        )
    return out


def cues_of(
    result: dict[str, Any], *, max_chars: int = 84, max_dur: float = 7.0, gap: float = 0.8
) -> list[tuple[float, float, str]]:
    """Group words into subtitle cues: break on pauses, long cues and sentence ends."""
    words = words_of(result)
    if not words:
        text = transcript_of(result)
        if not text:
            return []
        dur = float((result.get("metadata") or {}).get("duration") or 0.0) or 1.0
        return [(0.0, dur, text)]
    cues: list[tuple[float, float, str]] = []
    cur: list[dict[str, Any]] = []

    def flush() -> None:
        if cur:
            cues.append((cur[0]["start"], cur[-1]["end"], " ".join(w["word"] for w in cur)))
            cur.clear()

    for w in words:
        if cur:
            text_len = sum(len(x["word"]) + 1 for x in cur) + len(w["word"])
            if (
                w["start"] - cur[-1]["end"] >= gap
                or w["end"] - cur[0]["start"] > max_dur
                or text_len > max_chars
                or (cur[-1]["word"][-1:] in ".?!" and w["start"] - cur[0]["start"] > 2.0)
            ):
                flush()
        cur.append(w)
    flush()
    return cues


def _ts(t: float, sep: str) -> str:
    ms = int(round(max(t, 0.0) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def to_srt(result: dict[str, Any]) -> str:
    blocks = []
    for i, (a, b, text) in enumerate(cues_of(result), 1):
        blocks.append(f"{i}\n{_ts(a, ',')} --> {_ts(b, ',')}\n{text}\n")
    return "\n".join(blocks)


def to_vtt(result: dict[str, Any]) -> str:
    blocks = ["WEBVTT\n"]
    for a, b, text in cues_of(result):
        blocks.append(f"{_ts(a, '.')} --> {_ts(b, '.')}\n{text}\n")
    return "\n".join(blocks)


def to_json(result: dict[str, Any], include_words: bool = True) -> str:
    md = result.get("metadata") or {}
    out: dict[str, Any] = {
        "transcript": transcript_of(result),
        "duration_s": md.get("duration"),
        "request_id": md.get("request_id"),
        "utterances": [
            {"start": u.get("start"), "end": u.get("end"), "transcript": u.get("transcript")}
            for u in (result.get("results") or {}).get("utterances") or []
        ],
    }
    if include_words:
        out["words"] = words_of(result)
    return json.dumps(out, ensure_ascii=False, indent=1)


FORMATS = ("text", "json", "srt", "vtt")


def render(result: dict[str, Any], fmt: str = "text", include_words: bool = False) -> str:
    fmt = (fmt or "text").lower().strip()
    if fmt not in FORMATS:
        raise SaidwireError(f"Unknown format {fmt!r}. Use one of: {', '.join(FORMATS)}.")
    if fmt == "srt":
        return to_srt(result)
    if fmt == "vtt":
        return to_vtt(result)
    if fmt == "json":
        return to_json(result, include_words=include_words)
    text = transcript_of(result)
    if not text:
        text = "(no speech found in the audio)"
    if include_words:
        lines = [f"{w['start']:8.2f}  {w['end']:8.2f}  {w['word']}" for w in words_of(result)]
        text += "\n\nWords (start s, end s, word):\n" + "\n".join(lines)
    return text
