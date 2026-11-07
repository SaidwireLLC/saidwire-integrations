# Install the Saidwire MCP server

For AI assistants installing this server for a user.

1. Check that `uvx` is available. If not, install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`.
2. Ask the user for a Saidwire API key. They can get one at https://saidwire.com/dev: 120 free hours, no card. Keys start with `sk_live_`. Never print the key or commit it.
3. Add this to the MCP settings:

```json
{
  "mcpServers": {
    "saidwire": {
      "command": "uvx",
      "args": ["saidwire-mcp"],
      "env": { "SAIDWIRE_API_KEY": "<the user's key>" }
    }
  }
}
```

4. Test it: ask for `transcribe_file` on a short English recording.

Tools: `transcribe_file(path, format, include_words, output_path)` and `transcribe_url(url, format, include_words, output_path)`. `format` is `text`, `json`, `srt` or `vtt`.

Limits: English only, 100 MB and 60 minutes per file.
