# n8n-nodes-saidwire

This is an n8n community node. It lets you use [Saidwire](https://saidwire.com) speech-to-text in your n8n workflows.

Saidwire transcribes English audio to text, segment and word timestamps, or SRT/WebVTT subtitles.
It costs $0.30 per audio hour, billed per second, and new keys get 120 free hours with no card
([saidwire.com/dev](https://saidwire.com/dev)).

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation) ·
[Operations](#operations) ·
[Credentials](#credentials) ·
[Compatibility](#compatibility) ·
[Usage](#usage) ·
[Resources](#resources) ·
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation:

1. Go to **Settings > Community Nodes**.
2. Select **Install**.
3. Enter `n8n-nodes-saidwire` and confirm.

On a self-hosted instance without the UI option, run `npm install n8n-nodes-saidwire` in `~/.n8n/nodes`
and restart n8n.

## Operations

**Audio > Transcribe** ("Transcribe audio")

| Parameter | Description |
| --- | --- |
| Input Binary Field | Name of the binary field that holds the audio (default `data`) |
| Response Format | `JSON (Text Only)`, `Verbose JSON (Segments and Timestamps)`, `Plain Text`, `SRT Subtitles`, `WebVTT Subtitles` |
| Options > Language | `en` (default), a regional code such as `en-US`, or empty. English only. |
| Options > Timestamp Granularities | `Segment` and/or `Word` (Verbose JSON only) |
| Options > Put Output in File | Also return Plain Text, SRT or WebVTT output as a binary file |
| Options > Output Binary Field | Binary field for that file (default `data`) |

Output:

- **JSON**: `{ "text": "...", "usage": { "type": "duration", "seconds": 12.0 } }`
- **Verbose JSON**: `{ "task", "language", "duration", "text", "segments": [{ "id", "start", "end", "text", ... }], "words": [{ "word", "start", "end" }], "usage" }`
- **Plain Text**: `{ "text": "..." }`
- **SRT / WebVTT**: `{ "subtitles": "...", "format": "srt" }`, plus a `.srt` / `.vtt` binary file when **Put Output in File** is on

Audio files can be WAV, MP3, FLAC, Ogg/Opus, WebM or M4A/MP4, up to 100 MB and 60 minutes. For M4A/MP4, the file
index must be at the start of the file (for ffmpeg output, add `-movflags +faststart`).

## Credentials

1. Get an API key (`sk_live_...`) at [saidwire.com/dev](https://saidwire.com/dev).
2. In n8n, create a **Saidwire API** credential and paste the key into **API Key**.
   Leave **Base URL** as `https://api.saidwire.com/v1`.
3. Save. n8n checks the key by listing the account's models (`GET /v1/models`).

The key is sent as `Authorization: Bearer <key>`.

## Compatibility

- Built with `@n8n/node-cli` 0.54 and `n8n-workflow` 2.x. It uses the standard `httpRequestWithAuthentication` helper and has no runtime dependencies.
- Needs a recent n8n 1.x or 2.x with community nodes enabled.

## Usage

A typical workflow:

1. A node that outputs audio as binary data: **Read/Write Files from Disk**, an **HTTP Request** that downloads a
   file (Response Format: File), a **Form Trigger** with a file field, or a Google Drive / Dropbox download.
2. **Saidwire > Transcribe audio**, with **Input Binary Field** set to that node's binary field (usually `data`).
3. Use `{{ $json.text }}` in the next node, for example in an AI Agent, an email or a database row.

For subtitles, choose **SRT Subtitles**, turn on **Put Output in File**, and pass the binary on to a
**Write Files to Disk** or upload node.

Each input item is transcribed separately. Each key allows 2 files at once, so for large batches add a
**Loop Over Items** node with a small batch size. With **On Error > Continue**, failed items come back as
`{ "error": "..." }` and the rest of the batch keeps going.

Errors:

| Message | Fix |
| --- | --- |
| `401 Incorrect API key provided` | Check the key in the credential |
| `400 ... unsupported_language` | English only: set Language to `en` or leave it empty |
| `400 ... file` | The binary field is empty or not audio. Check **Input Binary Field** |
| `429` | Too many files at once, or the free hours are used up (the message says which) |

### Example workflow

[`examples/transcribe-audio-from-url.json`](https://github.com/SaidwireLLC/saidwire-integrations/blob/main/packages/n8n-nodes-saidwire/examples/transcribe-audio-from-url.json)
downloads an audio file with **HTTP Request** (Response Format: File) and transcribes it with **Saidwire >
Transcribe audio**. To use it, copy the file's contents, paste them onto the n8n canvas, set the URL to your
own audio file, and pick your **Saidwire API** credential.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Saidwire API reference](https://saidwire.com/docs/api)
- [Saidwire n8n guide](https://saidwire.com/static/guides/n8n.html)
- Support: support@saidwire.com (include the `x-request-id` from a failed call)

n8n is a trademark of n8n GmbH. Saidwire is not affiliated with n8n.

## Development

```bash
npm install
npm run lint        # n8n community node rules (strict, Cloud-eligible config)
npm test            # builds, then runs unit tests against a mocked n8n context
SAIDWIRE_LIVE=1 SAIDWIRE_API_KEY=sk_live_... SAIDWIRE_TEST_CLIP=/path/to/english.wav npm test   # adds live API calls
npm run dev         # starts a local n8n with this node loaded
```

## Version history

- **0.1.0**: initial release, with the Transcribe operation, five response formats and the Saidwire API credential.
