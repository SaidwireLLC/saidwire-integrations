# pipecat-saidwire

[Saidwire](https://saidwire.com) real-time speech-to-text for [Pipecat](https://github.com/pipecat-ai/pipecat).

`SaidwireSTTService` streams your user's audio to Saidwire over a WebSocket and pushes
`InterimTranscriptionFrame`s while they speak and a `TranscriptionFrame` when they finish.
When your VAD decides the user stopped talking, the service sends `Finalize`, and the
final transcript comes straight back, so turn-taking doesn't wait on a server-side pause.

Saidwire is English-only. Pricing is $0.30 per audio hour, billed per second of audio
sent. Get a key at [saidwire.com/dev](https://saidwire.com/dev).

This package is built and maintained by Saidwire, the company that runs the service.

**Tested with Pipecat v1.15.0** (Python 3.11+).

## Installation

```bash
uv add pipecat-saidwire
# or
pip install pipecat-saidwire
```

Set your key:

```bash
export SAIDWIRE_API_KEY=your_key
```

## Usage with a Pipecat pipeline

```python
from pipecat.pipeline.pipeline import Pipeline
from pipecat_saidwire import SaidwireSTTService

stt = SaidwireSTTService()  # reads SAIDWIRE_API_KEY

pipeline = Pipeline(
    [
        transport.input(),
        stt,
        user_aggregator,
        llm,
        tts,
        transport.output(),
        assistant_aggregator,
    ]
)
```

Already have a Pipecat bot? Replace your current STT service with the `stt = ...` line.
Nothing else changes.

## Running the example

[`examples/bot.py`](examples/bot.py) is a complete voice agent (Saidwire STT, plus an LLM,
a TTS service and a VAD) that you talk to from your browser:

```bash
pip install "pipecat-ai[webrtc,daily,silero,openai,cartesia,runner]" pipecat-saidwire
export SAIDWIRE_API_KEY=... OPENAI_API_KEY=... CARTESIA_API_KEY=...
python examples/bot.py
# open http://localhost:7860/client and start talking
```

[`examples/transcribe_file.py`](examples/transcribe_file.py) streams a WAV file through a
pipeline in real time and prints the transcripts. It needs only a Saidwire key:

```bash
python examples/transcribe_file.py call.wav
```

## How it behaves in a pipeline

| Pipecat | Saidwire |
|---|---|
| `InputAudioRawFrame` | streamed as 16-bit PCM at the pipeline's input rate (8-48 kHz) |
| `InterimTranscriptionFrame` | interim results while the user is speaking |
| `TranscriptionFrame` | final result for an utterance; its words won't change |
| `VADUserStoppedSpeakingFrame` | sends `Finalize`; the final comes back right away, marked `finalized=True` |
| `EndFrame` | sends `CloseStream`, then closes |
| `STTUpdateSettingsFrame` | applied by reconnecting between user turns |
| muted or idle | a `KeepAlive` message holds the stream open (silence would be billed as audio) |

Dropped connections reconnect with backoff. A bad or revoked key, or used-up credit, is
reported once as a permanent error, with no retry loop. If the service answers "starting
up" or "busy" (HTTP 503 or 429), the service waits for the `Retry-After` time and tries
again, for up to `warmup_timeout` seconds (default 300). Audio sent while it waits is not
transcribed.

## Configuration

```python
stt = SaidwireSTTService(
    api_key="...",  # default: $SAIDWIRE_API_KEY
    sample_rate=None,  # default: the pipeline's input rate
    settings=SaidwireSTTService.Settings(
        endpointing=None,  # server default; False = finals only from Finalize / long pauses
        interim_results=True,
        punctuate=True,
        early_words=False,  # True: on_early_word for each word as soon as it is committed
        vad_events=False,  # True: on_speech_started when the server hears speech begin
        utterance_end_ms=None,  # e.g. 1000: on_utterance_end after 1 s of silence
    ),
    vad_force_finalize=True,  # VADUserStoppedSpeakingFrame -> Finalize (recommended)
    warmup_timeout=300.0,
)
```

Constructor parameters:

| parameter | default | meaning |
|---|---|---|
| `api_key` | `$SAIDWIRE_API_KEY` | your Saidwire API key |
| `base_url` | `wss://api.saidwire.com/v1/listen` | streaming endpoint |
| `sample_rate` | pipeline input rate | 8000-48000 |
| `vad_force_finalize` | `True` | send `Finalize` when the VAD says the user stopped |
| `warmup_timeout` | `300.0` | seconds to keep retrying while the service is starting up |
| `ttfs_p99_latency` | `0.30` | hint for Pipecat turn strategies; measure your own deployment |

Runtime `Settings` (change them with `STTUpdateSettingsFrame`):

| setting | default | meaning |
|---|---|---|
| `model` | `saidwire-en-2026-10-30` | model id |
| `language` | `en` | `en`, `en-US`, `en-GB`, ... (English only) |
| `endpointing` | `None` | ms of pause that ends an utterance on the server; `False` to leave turn-taking to your VAD; `None` for the server default |
| `interim_results` | `True` | interim transcripts while the user speaks |
| `punctuate` | `True` | punctuation and capitals |
| `early_words` | `False` | `on_early_word` events |
| `vad_events` | `False` | `on_speech_started` events |
| `utterance_end_ms` | `None` | `on_utterance_end` events after this much silence |

## Events

```python
@stt.event_handler("on_early_word")
async def on_early_word(stt, word):
    # {"word": "cancel", "punctuated_word": "cancel.", "start": 6.84, "end": 7.29, ...}
    # Sent as soon as the word is committed, usually before the final that contains it.
    # Useful for keyword triggers ("stop", "cancel"). The final transcript is authoritative.
    ...


@stt.event_handler("on_speech_started")  # vad_events=True
async def on_speech_started(stt, message): ...


@stt.event_handler("on_utterance_end")  # utterance_end_ms set
async def on_utterance_end(stt, message): ...
```

Plus the standard `on_connected`, `on_disconnected` and `on_connection_error`.
`stt.request_id` is the id of the current stream; include it when you contact support.

## Protocol

Saidwire's streaming API uses the widely used `/v1/listen` protocol, so you can
also point an existing `/v1/listen` client at `wss://api.saidwire.com` with your Saidwire
key. This package adds Saidwire defaults and the extras above. API reference:
[saidwire.com/docs/api](https://saidwire.com/docs/api).

## Development

```bash
uv sync --group dev        # or: pip install -e . pytest pytest-asyncio ruff
pytest                     # runs against a fake server on 127.0.0.1; no key, no network
ruff check . && ruff format --check .
```

## Support

Open an issue on this repository, or email support@saidwire.com.

## License

MIT. See [LICENSE](LICENSE).
