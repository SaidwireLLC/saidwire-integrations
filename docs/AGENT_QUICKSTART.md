# Saidwire agent quickstart

For AI coding tools and the people using them.

**Three rules**

1. The API key lives on a server, in `SAIDWIRE_API_KEY`. Never put it in browser or mobile code, and never prefix it with `NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_` or `REACT_APP_`.
2. Browser apps call your own server, and your server calls Saidwire. There are no short-lived browser tokens.
3. Use only what is on this page. Many other parameters are accepted and silently ignored (see "What it does not do").

Get a key at https://saidwire.com/dev: 120 free hours, no card, then $0.30 per audio hour, billed per second.

## Transcribe a file

```bash
curl -s -X POST "https://api.saidwire.com/v1/listen?punctuate=true" \
  -H "Authorization: Token $SAIDWIRE_API_KEY" \
  -H "Content-Type: audio/wav" \
  --data-binary @meeting.wav \
  | jq -r '.results.channels[0].alternatives[0].transcript'
```

```python
import os, requests

with open("meeting.wav", "rb") as f:
    r = requests.post(
        "https://api.saidwire.com/v1/listen",
        params={"punctuate": "true"},
        headers={"Authorization": f"Token {os.environ['SAIDWIRE_API_KEY']}", "Content-Type": "audio/wav"},
        data=f,
    )
r.raise_for_status()
print(r.json()["results"]["channels"][0]["alternatives"][0]["transcript"])
```

Each word has `word`, `punctuated_word`, `start` and `end` at `results.channels[0].alternatives[0].words`. Add `utterances=true` for `results.utterances`, split at pauses.

A file already online needs no upload. It must be public and download within 30 seconds:

```bash
curl -s -X POST "https://api.saidwire.com/v1/listen?punctuate=true" \
  -H "Authorization: Token $SAIDWIRE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/episode.mp3"}'
```

## Get subtitles

```bash
curl -s -X POST "https://api.saidwire.com/v1/audio/transcriptions" \
  -H "Authorization: Bearer $SAIDWIRE_API_KEY" \
  -F file=@meeting.wav -F model=saidwire-en -F response_format=srt
```

`response_format` can be `json`, `text`, `verbose_json`, `srt` or `vtt`. On this endpoint the `words` list has no punctuation, so use `/v1/listen` when you build your own captions.

For video, send the audio only. It is much smaller, and it is the track your captions are timed to:

```bash
ffmpeg -i talk.mp4 -vn -ac 1 -ar 16000 -b:a 64k talk.mp3
```

## Add it to a web app

A Next.js route handler. The browser posts the recording to `/api/transcribe`, and the key stays on the server:

```js
// app/api/transcribe/route.js
export async function POST(request) {
  const res = await fetch('https://api.saidwire.com/v1/listen?punctuate=true', {
    method: 'POST',
    headers: {
      Authorization: `Token ${process.env.SAIDWIRE_API_KEY}`,
      'Content-Type': request.headers.get('content-type') || 'application/octet-stream',
    },
    body: await request.arrayBuffer(),
  });
  const data = await res.json();
  if (!res.ok) return Response.json({ error: data.err_msg || 'Transcription failed' }, { status: res.status });
  return Response.json({ text: data.results.channels[0].alternatives[0].transcript });
}
```

Before you deploy, add your own login check to this route: anyone who can call it can spend your audio hours.

Hosts often cap request size. For large files, have the browser upload to your storage, create a signed link, and send the link as `{"url": "..."}`.

## Stream live audio from a browser

A relay needs a host that keeps a WebSocket open for the whole recording. Many serverless platforms limit this, so check yours, or run this on a small Node host. `npm install ws`.

```js
// relay.mjs: browser -> this server -> Saidwire
import { WebSocket, WebSocketServer } from 'ws';

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;     // your site, for example https://app.example.com
const server = new WebSocketServer({
  port: Number(process.env.PORT || 8080),
  verifyClient: ({ origin }) => origin === ALLOWED_ORIGIN,   // add your own login check here too
});

server.on('connection', (browser, request) => {
  const rate = new URL(request.url, 'http://x').searchParams.get('sample_rate') || '16000';
  const params = new URLSearchParams({ encoding: 'linear16', sample_rate: rate, interim_results: 'true', punctuate: 'true' });
  const saidwire = new WebSocket(`wss://api.saidwire.com/v1/listen?${params}`, {
    headers: { Authorization: `Token ${process.env.SAIDWIRE_API_KEY}` },
  });
  const early = [];
  saidwire.on('open', () => early.splice(0).forEach((audio) => saidwire.send(audio)));
  saidwire.on('message', (message) => browser.send(message.toString()));
  saidwire.on('close', () => browser.close());
  saidwire.on('error', () => browser.close());
  browser.on('message', (audio, isBinary) => {
    if (!isBinary) return;
    if (saidwire.readyState === WebSocket.OPEN) saidwire.send(audio);
    else early.push(audio);
  });
  browser.on('close', () => {
    if (saidwire.readyState === WebSocket.OPEN) saidwire.send(JSON.stringify({ type: 'CloseStream' }));
  });
});
```

In the browser, capture the microphone with an `AudioWorklet`, convert samples to 16-bit PCM, send about 50 ms at a time, and pass `sample_rate=<audioContext.sampleRate>`.

Read each JSON message: a `Results` message has the text at `channel.alternatives[0].transcript`. `is_final: false` is a guess that the next message replaces. `is_final: true` will not change. `speech_final: true` means the speaker paused for `endpointing` ms (default 800, minimum 500).

If the microphone may go quiet, send `{"type": "KeepAlive"}` every few seconds: a stream with no audio for 10 seconds is closed. Send `{"type": "Finalize"}` to get the final words immediately.

## Errors

| Status | Meaning | What to do |
|---|---|---|
| 400 | Bad request, or audio it cannot read | Fix the request |
| 401 | Bad or missing key | Check `SAIDWIRE_API_KEY` |
| 402, or 429 with `insufficient_quota` | Hours used up | Add a card at https://saidwire.com/dev. Do not retry |
| 403 | Key revoked | Create a new key |
| 413 | Over 100 MB or 60 minutes | Split the file |
| 429 | Too many at once | Wait for `Retry-After`, then retry |
| 5xx | Temporary | Wait for `Retry-After`, then retry |

Include the `x-request-id` header value when you write to support@saidwire.com.

## Limits

- 100 MB and 60 minutes per file. A file request waits for the whole result.
- Per key: 2 file requests at once, 4 live streams at once, 60 new streams a minute, 4 hours per stream.
- Audio billed by the second, including silence.

## What it does not do

English only. Mono only. No speaker labels, multichannel, key-term boosting, redaction, number formatting, translation, summaries, callbacks or webhooks.

`diarize`, `keyterm`, `keywords`, `redact`, `numerals`, `multichannel`, `summarize`, `callback` and similar parameters are accepted and **silently ignored**. Do not write code that depends on them. `confidence` is a fixed 0.95, not a real score.

Accuracy depends on the audio: overlapping speakers, distant microphones and heavy noise cost the most. Test on your own recordings before you rely on it.

Full reference: https://saidwire.com/docs/api
