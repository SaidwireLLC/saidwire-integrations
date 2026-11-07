"""Saidwire MCP server: transcribe local audio files and public audio URLs.

Run with `uvx saidwire-mcp` (stdio). Needs SAIDWIRE_API_KEY; get a free key at
https://saidwire.com/dev.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import anyio

try:  # mcp >= 2: FastMCP was renamed MCPServer
    from mcp.server.mcpserver import MCPServer as _Server
    from mcp.server.mcpserver.exceptions import ToolError
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP as _Server
    from mcp.server.fastmcp.exceptions import ToolError

from . import __version__
from .client import (
    SIGNUP_URL,
    SaidwireError,
    Settings,
    download,
    read_local_file,
    render,
    transcribe_bytes,
)

Format = Literal["text", "json", "srt", "vtt"]

INSTRUCTIONS = (
    "Saidwire turns English speech into text. Use transcribe_file for audio on this computer "
    "(absolute path) and transcribe_url for a direct link to a public audio file. "
    "format='srt' or 'vtt' gives subtitles; format='json' or include_words=true gives "
    "per-word timestamps. Files up to 100 MB / 60 minutes. "
    f"If the key is missing or invalid, tell the user to get a free key at {SIGNUP_URL}."
)

mcp = _Server("saidwire", instructions=INSTRUCTIONS)


def _save(text: str, output_path: str | None) -> str:
    if not output_path:
        return text
    p = Path(output_path).expanduser()
    if not p.is_absolute():
        raise SaidwireError("output_path must be an absolute path.")
    if not p.parent.exists():
        raise SaidwireError(f"Folder does not exist: {p.parent}")
    p.write_text(text if text.endswith("\n") else text + "\n", encoding="utf-8")
    return f"Saved to {p} ({len(text)} characters).\n\n{text}"


async def _run(fn, *args) -> str:
    """Run a blocking call off the event loop; turn our errors into readable tool errors."""
    try:
        return await anyio.to_thread.run_sync(fn, *args)
    except SaidwireError as e:
        raise ToolError(str(e)) from e
    except OSError as e:
        raise ToolError(f"Could not read or write a file: {e}") from e


def _transcribe_file_sync(path: str, fmt: str, include_words: bool, output_path: str | None) -> str:
    settings = Settings.from_env()
    data, ctype, _ = read_local_file(path)
    result = transcribe_bytes(settings, data, ctype)
    return _save(render(result, fmt, include_words), output_path)


def _transcribe_url_sync(url: str, fmt: str, include_words: bool, output_path: str | None) -> str:
    settings = Settings.from_env()
    data, ctype = download(settings, url)
    result = transcribe_bytes(settings, data, ctype)
    return _save(render(result, fmt, include_words), output_path)


@mcp.tool()
async def transcribe_file(
    path: str,
    format: Format = "text",
    include_words: bool = False,
    output_path: str | None = None,
) -> str:
    """Transcribe a local audio file (WAV, MP3, FLAC, Ogg/Opus, WebM, M4A/MP4, AAC) to text.

    Args:
        path: Absolute path to the audio file on this computer (up to 100 MB / 60 minutes).
        format: "text" (plain transcript), "json" (transcript, utterances and word timestamps),
            "srt" or "vtt" (subtitles with timestamps).
        include_words: Add per-word start/end times (for "text" and "json").
        output_path: Optional absolute path to also save the result to, e.g. /path/talk.srt.
    """
    return await _run(_transcribe_file_sync, path, format, include_words, output_path)


@mcp.tool()
async def transcribe_url(
    url: str,
    format: Format = "text",
    include_words: bool = False,
    output_path: str | None = None,
) -> str:
    """Download a public audio file from an http(s) URL and transcribe it to text.

    The file is downloaded by this server (default limit 100 MB, set SAIDWIRE_MAX_DOWNLOAD_MB
    to change it) and sent to Saidwire. Use a direct link to the audio, not a web page.

    Args:
        url: Direct http(s) link to an audio file.
        format: "text", "json" (with word timestamps), "srt" or "vtt".
        include_words: Add per-word start/end times (for "text" and "json").
        output_path: Optional absolute path to also save the result to.
    """
    return await _run(_transcribe_url_sync, url, format, include_words, output_path)


def main() -> None:
    import sys

    if len(sys.argv) > 1 and sys.argv[1] in ("--version", "-V"):
        print(f"saidwire-mcp {__version__}")
        return
    if len(sys.argv) > 1 and sys.argv[1] in ("--help", "-h"):
        print(
            "saidwire-mcp: Saidwire speech-to-text MCP server (stdio).\n"
            "Set SAIDWIRE_API_KEY (free key: https://saidwire.com/dev) and add this command to "
            "your MCP client. Docs: https://saidwire.com/docs/api"
        )
        return
    mcp.run()


if __name__ == "__main__":
    main()
