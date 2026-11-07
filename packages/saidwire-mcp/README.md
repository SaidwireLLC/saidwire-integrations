# Saidwire MCP server

<!-- mcp-name: io.github.Saidwire/saidwire-mcp -->

Speech-to-text for Claude Desktop, Claude Code, Cursor, Windsurf, VS Code and any other
[Model Context Protocol](https://modelcontextprotocol.io) client. Ask your assistant to
transcribe a recording on your computer or at a public URL, and get plain text, subtitles
(SRT/VTT) or word-level timestamps back.

> "Transcribe ~/Downloads/standup.m4a and list the action items."
> "Make subtitles for https://example.com/talk.mp3 and save them to ~/talk.srt."

- **English** speech-to-text, punctuated and capitalised.
- WAV, MP3, FLAC, Ogg/Opus, WebM, M4A/MP4 and AAC, up to 100 MB / 60 minutes per file.
- **$0.30 per audio hour.** New keys include **120 free hours, no card needed**.
- Built and maintained by [Saidwire](https://saidwire.com), the company that runs the service.

## 1. Get a free API key

Sign up at **[saidwire.com/dev](https://saidwire.com/dev)** and copy your key
(it starts with `sk_live_`).

## 2. Add the server to your client

You need [uv](https://docs.astral.sh/uv/getting-started/installation/) (it provides `uvx`;
no Node or npm needed):

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh      # macOS / Linux
# Windows: powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

### Claude Desktop

Settings → Developer → Edit Config (`claude_desktop_config.json`), then restart Claude:

```json
{
  "mcpServers": {
    "saidwire": {
      "command": "uvx",
      "args": ["saidwire-mcp"],
      "env": { "SAIDWIRE_API_KEY": "sk_live_your_key_here" }
    }
  }
}
```

If Claude says it cannot find `uvx`, replace `"uvx"` with the full path from `which uvx`
(it usually ends in `/.local/bin/uvx`). Desktop apps do not always see your shell's PATH.

Or double-click `saidwire-mcp.mcpb` (from https://github.com/SaidwireLLC/saidwire-integrations/releases) to install it as a Claude
Desktop extension; Claude asks for the key.

### Claude Code

```bash
claude mcp add saidwire --scope user -e SAIDWIRE_API_KEY=sk_live_your_key_here -- uvx saidwire-mcp
```

### Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "saidwire": {
      "command": "uvx",
      "args": ["saidwire-mcp"],
      "env": { "SAIDWIRE_API_KEY": "sk_live_your_key_here" }
    }
  }
}
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`: the same `mcpServers` block as Cursor.

### VS Code (Copilot agent mode)

`.vscode/mcp.json`:

```json
{
  "inputs": [
    { "type": "promptString", "id": "saidwire-key", "description": "Saidwire API key", "password": true }
  ],
  "servers": {
    "saidwire": {
      "command": "uvx",
      "args": ["saidwire-mcp"],
      "env": { "SAIDWIRE_API_KEY": "${input:saidwire-key}" }
    }
  }
}
```

### Any other client

Command `uvx saidwire-mcp` (stdio transport), with `SAIDWIRE_API_KEY` in its environment.
`pip install saidwire-mcp` also works and installs a `saidwire-mcp` command.

## Tools

| tool | what it does |
|---|---|
| `transcribe_file(path, format="text", include_words=false, output_path=null)` | Transcribes an audio file on this computer. Use an absolute path. |
| `transcribe_url(url, format="text", include_words=false, output_path=null)` | Downloads a public audio file (direct http/https link) and transcribes it. |

- `format`: `text` (plain transcript), `json` (transcript, utterances and per-word
  timestamps), `srt` or `vtt` (subtitles).
- `include_words`: add per-word start and end times to `text` or `json` output.
- `output_path`: also save the result to this absolute path (for example `~/talk.srt`).

## Settings

| environment variable | default | |
|---|---|---|
| `SAIDWIRE_API_KEY` | (required) | Your key from [saidwire.com/dev](https://saidwire.com/dev). |
| `SAIDWIRE_MAX_DOWNLOAD_MB` | `100` | Size limit for `transcribe_url` downloads (max 100). |
| `SAIDWIRE_ALLOW_PRIVATE_URLS` | off | Set to `1` to let `transcribe_url` fetch from local or private network addresses. |
| `SAIDWIRE_API_URL` | `https://api.saidwire.com` | API base URL. |

## Privacy

The server runs on your computer. It reads only the files you ask it to transcribe, sends
the audio to the Saidwire API over HTTPS, and returns the text to your client. Your key stays
in your local client config. See "Data handling" in the
[API docs](https://saidwire.com/docs/api) for how the service treats audio.

## Troubleshooting

- **"SAIDWIRE_API_KEY is not set"**: add the `env` block shown above and restart the client.
- **"API key was not accepted" (401)**: copy the whole key, including the part after the dot.
- **"included hours are used up" (402)**: add hours at [saidwire.com/dev](https://saidwire.com/dev).
- **"web page, not an audio file"**: `transcribe_url` needs a direct link to the audio file,
  not a page that plays it.
- Anything else: support@saidwire.com (include the `request_id` from the error).

## The API

This server uses the pre-recorded endpoint `POST https://api.saidwire.com/v1/listen`.
Saidwire also offers real-time streaming over WebSocket and `POST /v1/audio/transcriptions`.
Docs: [saidwire.com/docs/api](https://saidwire.com/docs/api).

## Development

```bash
uv venv && uv pip install -e ".[test]"
.venv/bin/pytest                                   # offline unit tests + MCP stdio no-key test
SAIDWIRE_API_KEY=sk_live_... SAIDWIRE_TEST_AUDIO=/abs/path/clip.wav .venv/bin/pytest -m live -v
```

## License

MIT
