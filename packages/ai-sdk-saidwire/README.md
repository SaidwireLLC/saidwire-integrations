# Saidwire provider for the AI SDK

[Saidwire](https://saidwire.com) speech-to-text for the [AI SDK](https://ai-sdk.dev).
Use it with `transcribe()` to turn English audio into text, with segment and word
timestamps.

- English only.
- $0.30 per audio hour, billed per second. 120 free hours, no card:
  [saidwire.com/dev](https://saidwire.com/dev).
- API reference: [saidwire.com/docs/api](https://saidwire.com/docs/api).

## Install

```bash
npm install @saidwire/ai-sdk-provider ai@^7
```

Requires AI SDK 7 (`ai@^7`) and Node.js 18 or later.

## API key

Get a key (`sk_live_...`) at [saidwire.com/dev](https://saidwire.com/dev) and set it
in your environment:

```bash
export SAIDWIRE_API_KEY=sk_live_...
```

## Transcribe a file

```ts
import { saidwire } from '@saidwire/ai-sdk-provider';
import { transcribe } from 'ai';
import { readFile } from 'node:fs/promises';

const result = await transcribe({
  model: saidwire.transcription('saidwire-en'),
  audio: await readFile('meeting.wav'),
});

console.log(result.text);
console.log(result.segments); // [{ text, startSecond, endSecond }, ...]
console.log(result.durationInSeconds, result.language); // 12, 'en'
```

`audio` can be a `Uint8Array`, `Buffer`, `ArrayBuffer`, base64 string or a `URL`
(the AI SDK downloads it first). WAV, MP3, FLAC, Ogg/Opus, WebM and M4A/MP4 work,
up to 100 MB and 60 minutes per file. For M4A/MP4, the file index must be at the
start of the file (browser recordings already are; for ffmpeg output add
`-movflags +faststart`).

## Provider settings

```ts
import { createSaidwire } from '@saidwire/ai-sdk-provider';

const saidwire = createSaidwire({
  apiKey: process.env.SAIDWIRE_API_KEY, // default: SAIDWIRE_API_KEY
  baseURL: 'https://api.saidwire.com/v1', // default
  headers: { 'x-my-header': 'value' }, // optional, sent with every request
  fetch: customFetch, // optional
});
```

| setting   | default                       | notes                                        |
| --------- | ----------------------------- | -------------------------------------------- |
| `apiKey`  | `SAIDWIRE_API_KEY` env var    | sent as `Authorization: Bearer ...`          |
| `baseURL` | `https://api.saidwire.com/v1` | trailing slash is ignored                    |
| `headers` | none                          | extra request headers                        |
| `fetch`   | global `fetch`                | custom implementation, e.g. for tests/proxies |

Model ID: `saidwire-en`. `saidwire('saidwire-en')` and
`saidwire.transcriptionModel('saidwire-en')` do the same as
`saidwire.transcription('saidwire-en')`.

## Provider options

Pass per-call options under `providerOptions.saidwire`:

```ts
const result = await transcribe({
  model: saidwire.transcription('saidwire-en'),
  audio,
  providerOptions: {
    saidwire: {
      language: 'en', // optional: 'en', 'en-US', 'english'
      timestampGranularities: ['word', 'segment'], // default ['segment']
    },
  },
});
```

| option                   | type                       | default       | notes                                                                    |
| ------------------------ | -------------------------- | ------------- | ------------------------------------------------------------------------ |
| `language`               | `string`                   | none          | English only. Any other language gets a 400 error.                       |
| `timestampGranularities` | `('word' \| 'segment')[]`  | `['segment']` | add `'word'` for per-word timings                                        |

## Word timestamps

With `'word'` in `timestampGranularities`, per-word timings come back in
`providerMetadata.saidwire.words`:

```ts
const words = result.providerMetadata?.saidwire?.words as
  | { word: string; start: number; end: number }[]
  | undefined;
```

If you ask for words only (`['word']`), `result.segments` holds one entry per word.

## Errors

Failed calls throw `APICallError` from `@ai-sdk/provider`, with `statusCode`, the
server's message and `responseHeaders` (include `x-request-id` when you email
support).

| status | meaning                                                                         | retried by the AI SDK |
| ------ | ------------------------------------------------------------------------------- | --------------------- |
| 400    | bad request: not audio, empty file, or a non-English `language`                 | no                    |
| 401    | key missing, wrong or revoked                                                   | no                    |
| 429    | too many files at once for your key (2 at once per key)                        | yes                   |
| 429    | free hours or monthly quota used up (`insufficient_quota`)                      | no                    |
| 5xx    | server error                                                                    | yes                   |

A missing key throws `LoadAPIKeyError` before any request is sent.

## Live audio

This package covers files and recordings (`transcribe`). For live audio, Saidwire
has a streaming WebSocket API (`/v1/listen`); see the
[API docs](https://saidwire.com/docs/api). Support for the AI SDK's streaming
transcription interface may come in a later version.

## Compatibility

The Saidwire transcription endpoint is `POST /v1/audio/transcriptions`. This package
sets the right defaults (segments for any model ID), maps Saidwire's errors and
returns word timestamps.

## Development

```bash
npm install
npm run typecheck
npm test                     # unit tests, no network
SAIDWIRE_API_KEY=sk_live_... SAIDWIRE_TEST_AUDIO=./clip.wav npm run test:live
npm run build
```

## Support

Email [support@saidwire.com](mailto:support@saidwire.com).

## License

MIT. See [LICENSE](./LICENSE).

Vercel and AI SDK are trademarks of Vercel, Inc. Saidwire is not affiliated with Vercel.
