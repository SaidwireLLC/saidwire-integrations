# Saidwire public code

Client code for the [Saidwire](https://saidwire.com) speech-to-text API: framework plugins, an MCP server, starter templates, copy-paste prompts for AI coding tools, and short docs.

This repository holds client code only. Everything here talks to the public API at `https://api.saidwire.com`. You need your own API key from [saidwire.com/dev](https://saidwire.com/dev). Never commit a key.

## What is here

| Folder | What it is | Install | Licence |
|---|---|---|---|
| [`packages/livekit-plugins-saidwire`](packages/livekit-plugins-saidwire) | Speech-to-text plugin for LiveKit Agents | `pip install livekit-plugins-saidwire` | Apache-2.0 |
| [`packages/pipecat-saidwire`](packages/pipecat-saidwire) | Speech-to-text service for Pipecat | `pip install pipecat-saidwire` | MIT |
| [`packages/n8n-nodes-saidwire`](packages/n8n-nodes-saidwire) | n8n community node | `n8n-nodes-saidwire` in n8n's Community Nodes screen | MIT |
| [`packages/ai-sdk-saidwire`](packages/ai-sdk-saidwire) | Provider for the Vercel AI SDK | `npm install @saidwire/ai-sdk-provider` | MIT |
| [`packages/saidwire-mcp`](packages/saidwire-mcp) | MCP server for transcribing files and links | `uvx saidwire-mcp` | MIT |
| [`templates`](templates) | Small apps to copy: voice notes, meeting notes, video captions, podcast transcripts | See each template's README | See [LICENSE](LICENSE) |
| [`prompts`](prompts) | One copy-paste prompt per AI coding tool. Start at [`INDEX.md`](prompts/INDEX.md) | Copy and paste | See [LICENSE](LICENSE) |
| [`docs`](docs) | [`AGENT_QUICKSTART.md`](docs/AGENT_QUICKSTART.md) and [`llms.txt`](docs/llms.txt), written for AI coding tools | Read | See [LICENSE](LICENSE) |

Each package has its own README, tests and licence file.

## Run the tests

No test here needs a key or calls the real API unless you turn on the live tests yourself. Each package README has the steps.

## Licence

See [LICENSE](LICENSE). The packages do not all use the same licence.

## Support

Email support@saidwire.com. API reference: [saidwire.com/docs/api](https://saidwire.com/docs/api).
